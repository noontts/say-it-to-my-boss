package http_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"say-it-to-my-boss/backend/internal/game"
	transport "say-it-to-my-boss/backend/internal/transport/http"
)

func TestMockPracticeVoicesUseSavedCharacterAndReply(t *testing.T) {
	catalog, err := game.LoadCatalog("../../../../scenarios")
	if err != nil {
		t.Fatal(err)
	}
	type speechRequest struct {
		ScenarioID string `json:"scenarioId"`
		Text       string `json:"text"`
	}
	forwarded := make(chan speechRequest, 3)
	worker := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var input speechRequest
		if r.Method != http.MethodPost || r.URL.Path != "/speak" || json.NewDecoder(r.Body).Decode(&input) != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		select {
		case forwarded <- input:
		default:
		}
		w.Header().Set("Content-Type", "audio/wav")
		_, _ = w.Write([]byte("sample audio"))
	}))
	defer worker.Close()
	practice := game.NewPractice(catalog, game.MockPracticeAI{})
	router := gin.New()
	api := router.Group("/api/v1")
	transport.RegisterPractice(api, practice)
	transport.RegisterPracticeVoice(api, practice, worker.URL)

	const sessions = "/api/v1/sessions"
	for _, id := range []string{"angry-boss", "demanding-client", "difficult-customer"} {
		t.Run(id, func(t *testing.T) {
			session := postSession(t, router, sessions, map[string]string{"scenarioId": id}, http.StatusCreated)
			path := sessions + "/" + session.ID
			input := game.SubmitInput{RequestID: "reply", Text: "รับทราบค่ะ"}
			next := postSession(t, router, path+"/messages", input, http.StatusOK)
			scenario, _ := catalog.Get(id)
			reply := next.Messages[2].Text
			if next.Mode != "ai" || reply == scenario.Practice.LocalReplies[0] {
				t.Fatalf("expected a simulated AI reply, got %+v", next)
			}
			request(t, router, path+"/voice/1", http.StatusNotFound)
			request(t, router, path+"/voice/3", http.StatusNotFound)
			response := request(t, router, path+"/voice/2?scenarioId=other&text=override", http.StatusOK)
			if response.Body.String() != "sample audio" || response.Header().Get("Content-Type") != "audio/wav" {
				t.Fatalf("unexpected audio response: %v %q", response.Header(), response.Body.String())
			}
			select {
			case got := <-forwarded:
				if got != (speechRequest{ScenarioID: id, Text: reply}) {
					t.Fatalf("unexpected speech request: %+v", got)
				}
			default:
				t.Fatal("missing speech request")
			}
		})
	}
}
