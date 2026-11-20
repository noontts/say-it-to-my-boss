package llm

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"say-it-to-my-boss/backend/internal/game"
	transport "say-it-to-my-boss/backend/internal/transport/http"
)

func TestPracticeWithMockOpenRouter(t *testing.T) {
	catalog, err := game.LoadCatalog("../../../scenarios")
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		scenario string
		answers  [3]string
		replies  [3]string
		outcome  string
	}{
		{
			"angry-boss",
			[3]string{"ตอนนี้สรุปพร้อมแล้วค่ะ ตัวเลขส่วนที่เหลือยังตรวจไม่เสร็จ", "ส่งสรุปให้ได้ตอนห้าโมงค่ะ", "ส่งฉบับเต็มพรุ่งนี้แปดโมง ถ้าติดขัดจะแจ้งก่อนหนึ่งทุ่มค่ะ"},
			[3]string{"งั้นผมขอสรุปที่พร้อมก่อนครับ จะส่งได้กี่โมง?", "ผมจะใช้สรุปที่คุณส่งตอนห้าโมงเตรียมประชุมครับ แล้วฉบับเต็มล่ะครับ?", "ตกลงครับ ผมจะรอฉบับเต็มตอนแปดโมง"},
			"succeeded",
		},
		{
			"demanding-client",
			[3]string{"เข้าใจว่าต้องเปิดตัววันจันทร์ค่ะ แต่สื่อทั้งชุดทำไม่ทัน", "ส่งภาพหลักวันศุกร์ก่อนบ่ายสามโมงค่ะ", "ส่วนที่เหลือส่งวันอังคารและแจ้งความคืบหน้าวันจันทร์ค่ะ"},
			[3]string{"งั้นเริ่มจากภาพหลักได้ค่ะ จะส่งได้วันไหนคะ?", "ได้ค่ะ ฉันจะให้ทีมรอรับภาพบ่ายสาม แล้วไฟล์ที่เหลือล่ะคะ?", "ตกลงค่ะ ฉันจะรออัปเดตวันจันทร์"},
			"succeeded",
		},
		{
			"difficult-customer",
			[3]string{"ขอโทษที่ต้องเสียเวลานะคะ", "พ้นกำหนดคืนเงินแล้วค่ะ", "ตอนนี้ยังบอกไม่ได้ค่ะว่าจะช่วยอย่างไร"},
			[3]string{"หมดเขตเมื่อวานเองค่ะ พอจะช่วยได้ไหมคะ?", "ถ้าคืนเงินไม่ได้ มีทางเลือกอื่นไหมคะ?", "ถ้าอย่างนั้นฉันขอกลับก่อนค่ะ"},
			"needs_practice",
		},
	} {
		t.Run(tc.scenario, func(t *testing.T) {
			scenario, ok := catalog.Get(tc.scenario)
			if !ok {
				t.Fatalf("missing scenario %s", tc.scenario)
			}

			var steps []mockCompletion
			history := []chatMessage{{Role: "assistant", Content: scenario.Practice.Opening}}
			transcript := []game.Message{{Role: "npc", Text: scenario.Practice.Opening}}
			for turn, answer := range tc.answers {
				messages := append(append([]chatMessage{}, history...), chatMessage{Role: "user", Content: answer})
				if turn == 0 && tc.scenario == "angry-boss" {
					steps = append(steps, mockCompletion{messages: messages, timeout: true})
				}
				if turn == 1 {
					steps = append(steps, mockCompletion{messages: messages, response: `{"reply":"บทตอบที่ไม่ควรถูกบันทึก","trustDelta":99,"achieved":[]}`})
				}
				delta := 10
				achieved := []string{scenario.Practice.Objectives[turn].ID}
				if turn == 2 && tc.outcome == "needs_practice" {
					delta = -10
					achieved = []string{}
				}
				steps = append(steps, mockCompletion{messages: messages, response: string(mockJSON(t, game.NPCReply{
					Text: tc.replies[turn], TrustDelta: &delta, Achieved: achieved,
				}))})
				history = append(messages, chatMessage{Role: "assistant", Content: tc.replies[turn]})
				transcript = append(transcript, game.Message{Role: "player", Text: answer}, game.Message{Role: "npc", Text: tc.replies[turn]})
			}

			evaluation := []chatMessage{{Role: "user", Content: string(mockJSON(t, transcript))}}
			coaching := game.Coaching{
				Scores:      map[string]int{"clarity": 82, "empathy": 78, "professionalism": 90, "problemSolving": 76},
				Strengths:   []string{"อธิบายสถานการณ์อย่างสุภาพ"},
				Suggestions: []string{"ทวนสิ่งที่ตกลงกันก่อนจบบทสนทนา"},
				Summary:     "การชี้แจงอย่างสุภาพช่วยให้อีกฝ่ายเข้าใจสถานการณ์",
			}
			steps = append(steps,
				mockCompletion{messages: evaluation, response: `{"scores":{"clarity":null}}`},
				mockCompletion{messages: evaluation, response: string(mockJSON(t, coaching))},
			)
			ai, calls := mockOpenRouter(t, scenario.Practice.Persona, steps)
			router := gin.New()
			transport.RegisterPractice(router.Group("/api/v1"), game.NewPractice(catalog, ai))
			app := httptest.NewServer(router)
			defer app.Close()

			const sessions = "/api/v1/sessions"
			setup := map[string]string{"scenarioId": tc.scenario}
			state := mockSessionRequest(t, app, "POST", sessions, setup, http.StatusCreated)
			if state.Mode != "ai" || state.TurnLimit != len(tc.answers) || !reflect.DeepEqual(state.Messages, transcript[:1]) {
				t.Fatalf("unexpected AI session: %+v", state)
			}
			sessionPath := sessions + "/" + state.ID
			for turn, answer := range tc.answers {
				input := game.SubmitInput{RequestID: fmt.Sprintf("turn-%d", turn), Turn: turn, Text: answer}
				if turn == 1 || (turn == 0 && tc.scenario == "angry-boss") {
					mockSessionRequest(t, app, "POST", sessionPath+"/messages", input, http.StatusBadGateway)
					if after := mockSessionRequest(t, app, "GET", sessionPath, nil, http.StatusOK); !reflect.DeepEqual(after, state) {
						t.Fatalf("failed turn changed session: %+v", after)
					}
				}
				state = mockSessionRequest(t, app, "POST", sessionPath+"/messages", input, http.StatusOK)
				if state.Turn != turn+1 || !reflect.DeepEqual(state.Messages, transcript[:2*turn+3]) {
					t.Fatalf("unexpected saved turn: %+v", state)
				}
			}

			mockSessionRequest(t, app, "POST", sessionPath+"/finish", nil, http.StatusBadGateway)
			if after := mockSessionRequest(t, app, "GET", sessionPath, nil, http.StatusOK); !reflect.DeepEqual(after, state) {
				t.Fatalf("failed coaching changed session: %+v", after)
			}
			finished := mockSessionRequest(t, app, "POST", sessionPath+"/finish", nil, http.StatusOK)
			wantTrust, wantCompletion := 80, 100
			if tc.outcome == "needs_practice" {
				wantTrust, wantCompletion = 60, 66
			}
			want := &game.Results{Coaching: coaching, ObjectiveCompletion: wantCompletion}
			if finished.Status != tc.outcome || finished.Trust != wantTrust || !reflect.DeepEqual(finished.Results, want) {
				t.Fatalf("unexpected finished session: %+v, results: %+v", finished, finished.Results)
			}
			if restored := mockSessionRequest(t, app, "GET", sessionPath, nil, http.StatusOK); !reflect.DeepEqual(restored, finished) {
				t.Fatal("reloading changed the saved results")
			}
			if again := mockSessionRequest(t, app, "POST", sessionPath+"/finish", nil, http.StatusOK); !reflect.DeepEqual(again, finished) {
				t.Fatal("repeating finish changed the saved results")
			}
			replay := mockSessionRequest(t, app, "POST", sessions, setup, http.StatusCreated)
			if replay.ID == state.ID || replay.Turn != 0 || replay.Results != nil || len(replay.Messages) != 1 {
				t.Fatalf("unexpected replay: %+v", replay)
			}
			if got := int(calls.Load()); got != len(steps) {
				t.Fatalf("provider received %d calls, want %d", got, len(steps))
			}
		})
	}
}

type mockCompletion struct {
	messages []chatMessage
	response string
	timeout  bool
}

func mockOpenRouter(t *testing.T, persona string, steps []mockCompletion) (*OpenRouter, *atomic.Int32) {
	t.Helper()
	var calls atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		index := int(calls.Add(1)) - 1
		if index >= len(steps) {
			t.Errorf("unexpected provider call %d", index+1)
			http.Error(w, "unexpected request", http.StatusBadRequest)
			return
		}
		var request struct {
			Model    string        `json:"model"`
			Messages []chatMessage `json:"messages"`
			Format   struct {
				Type string `json:"type"`
			} `json:"response_format"`
		}
		step := steps[index]
		err := json.NewDecoder(r.Body).Decode(&request)
		if err != nil || r.Method != "POST" || r.URL.Path != "/api/v1/chat/completions" ||
			r.Header.Get("Authorization") != "Bearer mock-key" || request.Model != "mock-model" ||
			request.Format.Type != "json_object" || len(request.Messages) != len(step.messages)+1 ||
			request.Messages[0].Role != "system" || !strings.Contains(request.Messages[0].Content, persona) ||
			!reflect.DeepEqual(request.Messages[1:], step.messages) {
			t.Errorf("unexpected provider request %d: %+v, decode error: %v", index+1, request, err)
			http.Error(w, "unexpected request", http.StatusBadRequest)
			return
		}
		if step.timeout {
			select {
			case <-r.Context().Done():
			case <-time.After(3 * time.Second):
				t.Error("provider request was not canceled")
			}
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{
			"finish_reason": "stop", "message": chatMessage{Role: "assistant", Content: step.response},
		}}})
	}))
	t.Cleanup(provider.Close)

	// Keep production routing fixed to OpenRouter. Only this test redirects its transport.
	destination, err := url.Parse(provider.URL)
	if err != nil {
		t.Fatal(err)
	}
	ai := NewOpenRouter("mock-key", "mock-model")
	ai.client.Timeout = 500 * time.Millisecond
	ai.client.Transport = roundTripFunc(func(request *http.Request) (*http.Response, error) {
		if request.URL.String() != openRouterURL {
			return nil, fmt.Errorf("unexpected provider URL: %s", request.URL)
		}
		local := request.Clone(request.Context())
		local.URL.Scheme, local.URL.Host = destination.Scheme, destination.Host
		local.Host = destination.Host
		return provider.Client().Transport.RoundTrip(local)
	})
	return ai, &calls
}

func mockSessionRequest(t *testing.T, app *httptest.Server, method, path string, body any, status int) game.Session {
	t.Helper()
	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(mockJSON(t, body))
	}
	request, err := http.NewRequest(method, app.URL+path, reader)
	if err != nil {
		t.Fatal(err)
	}
	response, err := app.Client().Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != status {
		data, _ := io.ReadAll(response.Body)
		t.Fatalf("%s %s: got %d, want %d: %s", method, path, response.StatusCode, status, data)
	}
	var session game.Session
	if err := json.NewDecoder(response.Body).Decode(&session); err != nil {
		t.Fatal(err)
	}
	return session
}

func mockJSON(t *testing.T, value any) []byte {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return data
}
