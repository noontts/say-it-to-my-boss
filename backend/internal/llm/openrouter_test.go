package llm

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"say-it-to-my-boss/backend/internal/game"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return f(request)
}

func TestOpenRouterIncludesHistoryAndParsesReply(t *testing.T) {
	client := NewOpenRouter("test-key", "test-model")
	client.client.Transport = roundTripFunc(func(request *http.Request) (*http.Response, error) {
		if request.URL.String() != openRouterURL || request.Header.Get("Authorization") != "Bearer test-key" {
			t.Fatal("unexpected OpenRouter request")
		}
		var payload struct {
			Model    string        `json:"model"`
			Messages []chatMessage `json:"messages"`
		}
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		if payload.Model != "test-model" || len(payload.Messages) != 5 {
			t.Fatalf("unexpected payload: %+v", payload)
		}
		wantRoles := []string{"system", "assistant", "user", "assistant", "user"}
		for i, role := range wantRoles {
			if payload.Messages[i].Role != role {
				t.Errorf("message %d role = %q, want %q", i, payload.Messages[i].Role, role)
			}
		}
		if payload.Messages[4].Content != "ก่อนห้าโมงค่ะ" {
			t.Error("latest player message missing")
		}
		system := payload.Messages[0].Content
		if !strings.Contains(system, "NPC, พี่นนท์") ||
			!strings.Contains(system, "NPC persona and responsibilities: เรียกตัวเองว่าผม") {
			t.Error("system prompt is missing the character name or persona")
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Body: io.NopCloser(strings.NewReader(
				`{"choices":[{"finish_reason":"stop","message":{"content":"{\"reply\":\"ตกลงครับ\",\"trustDelta\":10,\"achieved\":[\"partial-delivery\"],\"endCall\":false}"}}]}`,
			)),
		}, nil
	})
	scenario := game.Scenario{
		Summary:  game.Summary{Character: "พี่นนท์ · หัวหน้าทีม"},
		Practice: &game.PracticeSpec{Persona: "เรียกตัวเองว่าผม"},
	}
	state := game.Session{
		Turn: 1, TurnLimit: 3, Trust: 50,
		Messages: []game.Message{
			{Role: "npc", Text: "รายงานอยู่ไหนครับ"},
			{Role: "player", Text: "กำลังตรวจตัวเลขค่ะ"},
			{Role: "npc", Text: "จะเสร็จเมื่อไหร่ครับ"},
		},
	}
	reply, err := client.Reply(context.Background(), scenario, state, "ก่อนห้าโมงค่ะ")
	if err != nil || reply.Text != "ตกลงครับ" || reply.TrustDelta == nil || *reply.TrustDelta != 10 ||
		len(reply.Achieved) != 1 || reply.Achieved[0] != "partial-delivery" || reply.EndCall == nil || *reply.EndCall {
		t.Fatalf("reply = %+v, error = %v", reply, err)
	}
}

func TestOpenRouterEvaluationUsesTranscriptAndRejectsNullScores(t *testing.T) {
	t.Run("valid", func(t *testing.T) {
		testEvaluation(t, 90, false)
	})
	t.Run("null is not zero", func(t *testing.T) {
		testEvaluation(t, nil, true)
	})
}

func testEvaluation(t *testing.T, clarity any, wantError bool) {
	t.Helper()
	client := NewOpenRouter("test-key", "test-model")
	client.client.Transport = roundTripFunc(func(request *http.Request) (*http.Response, error) {
		var payload struct {
			Messages []chatMessage `json:"messages"`
		}
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		if len(payload.Messages) != 2 || !strings.Contains(payload.Messages[0].Content, "ลูกค้าหน้าร้าน") ||
			!strings.Contains(payload.Messages[1].Content, "ขอใบเสร็จด้วยค่ะ") ||
			!strings.Contains(payload.Messages[1].Content, "ขอคืนเงินได้ไหมคะ") {
			t.Fatalf("evaluation is missing role or dialogue: %+v", payload.Messages)
		}
		coaching, err := json.Marshal(map[string]any{
			"scores":  map[string]any{"clarity": clarity, "empathy": 75, "professionalism": 90, "problemSolving": 80},
			"summary": "เสนอขั้นตอนถัดไป", "strengths": []string{}, "suggestions": []string{"บอกเวลาที่จะติดต่อกลับ"},
		})
		if err != nil {
			t.Fatal(err)
		}
		envelope, err := json.Marshal(map[string]any{"choices": []any{map[string]any{
			"finish_reason": "stop", "message": chatMessage{Content: string(coaching)},
		}}})
		if err != nil {
			t.Fatal(err)
		}
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(string(envelope)))}, nil
	})
	result, err := client.Evaluate(context.Background(),
		game.Scenario{Practice: &game.PracticeSpec{Persona: "ลูกค้าหน้าร้าน"}},
		game.Session{Messages: []game.Message{
			{Role: "npc", Text: "ขอคืนเงินได้ไหมคะ"},
			{Role: "player", Text: "ขอใบเสร็จด้วยค่ะ"},
		}},
	)
	if wantError {
		if err == nil {
			t.Fatal("accepted a null score")
		}
		return
	}
	if err != nil || result.Scores["clarity"] != 90 || result.Summary == "" || len(result.Suggestions) != 1 {
		t.Fatalf("evaluation = %+v, error = %v", result, err)
	}
}
