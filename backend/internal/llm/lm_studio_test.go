package llm

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"say-it-to-my-boss/backend/internal/game"
)

func TestLMStudioUsesStructuredOutputForReplyAndCoaching(t *testing.T) {
	responses := map[string]struct {
		tokens  int
		content string
	}{
		"npc_reply": {768, `{"reply":"ตกลงครับ","trustDelta":10,"achieved":[],"endCall":true}`},
		"coaching":  {2048, `{"scores":{"clarity":90,"empathy":80,"professionalism":85,"problemSolving":75},"strengths":[],"suggestions":["เสนอเวลาที่ชัดเจน"],"summary":"ตอบสุภาพ"}`},
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload struct {
			Model          string          `json:"model"`
			Messages       []chatMessage   `json:"messages"`
			MaxTokens      int             `json:"max_tokens"`
			Reasoning      string          `json:"reasoning_effort"`
			Provider       json.RawMessage `json:"provider"`
			ResponseFormat struct {
				Type       string `json:"type"`
				JSONSchema struct {
					Name   string `json:"name"`
					Schema struct {
						Type string `json:"type"`
					} `json:"schema"`
				} `json:"json_schema"`
			} `json:"response_format"`
		}
		err := json.NewDecoder(r.Body).Decode(&payload)
		format := payload.ResponseFormat
		response, ok := responses[format.JSONSchema.Name]
		if err != nil || !ok || r.Method != "POST" || r.URL.Path != "/v1/chat/completions" ||
			r.Header.Get("Authorization") != "Bearer local-token" || payload.Model != "qwen2.5-0.5b-instruct" ||
			payload.MaxTokens != response.tokens || payload.Reasoning != "none" || payload.Provider != nil || format.Type != "json_schema" ||
			format.JSONSchema.Schema.Type != "object" || len(payload.Messages) < 2 {
			t.Errorf("unexpected LM Studio request: %s %s %+v (%v)", r.Method, r.URL.Path, payload, err)
			http.Error(w, "unexpected request", http.StatusBadRequest)
			return
		}
		if format.JSONSchema.Name == "npc_reply" {
			if len(payload.Messages) != 5 ||
				payload.Messages[1].Role != "assistant" || payload.Messages[2].Role != "user" ||
				payload.Messages[2].Content != "ผมขี้เกียจทำพอดีอ่ะ" || payload.Messages[3].Role != "assistant" ||
				payload.Messages[4] != (chatMessage{Role: "user", Content: "เอาสรุปคุณทำหรือผมทำเนี่ย"}) ||
				!strings.Contains(payload.Messages[0].Content, "In a player line, “ผม” or “ฉัน” refers to the player") {
				t.Errorf("reply request did not distinguish speakers: %+v", payload.Messages)
			}
		} else {
			var lines []game.Message
			if len(payload.Messages) != 2 || payload.Messages[1].Role != "user" ||
				json.Unmarshal([]byte(payload.Messages[1].Content), &lines) != nil ||
				len(lines) != 1 || lines[0] != (game.Message{Role: "player", Text: "ผมขี้เกียจทำพอดีอ่ะ"}) {
				t.Errorf("coaching request did not isolate player dialogue: %+v", payload.Messages)
			}
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{
			"finish_reason": "stop", "message": chatMessage{Role: "assistant", Content: response.content},
		}}})
	}))
	defer server.Close()

	client, err := NewLMStudio(server.URL+"/v1/", "local-token", "qwen2.5-0.5b-instruct")
	if err != nil {
		t.Fatal(err)
	}
	scenario := game.Scenario{Practice: &game.PracticeSpec{Persona: "หัวหน้าทีม"}}
	session := game.Session{Messages: []game.Message{
		{Role: "npc", Text: "รายงานเลยกำหนดแล้วครับ"},
		{Role: "player", Text: "ผมขี้เกียจทำพอดีอ่ะ"},
		{Role: "npc", Text: "จะส่งได้เมื่อไหร่ครับ"},
	}}
	reply, err := client.Reply(t.Context(), scenario, session, "เอาสรุปคุณทำหรือผมทำเนี่ย")
	if err != nil || reply.Text != "ตกลงครับ" || reply.EndCall == nil || !*reply.EndCall {
		t.Fatalf("reply = %+v, error = %v", reply, err)
	}
	result, err := client.Evaluate(t.Context(), scenario, session)
	if err != nil || result.Scores["clarity"] != 90 {
		t.Fatalf("coaching = %+v, error = %v", result, err)
	}
}
