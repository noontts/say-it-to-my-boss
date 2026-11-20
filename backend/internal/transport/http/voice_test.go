package http_test

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"say-it-to-my-boss/backend/internal/game"
	transport "say-it-to-my-boss/backend/internal/transport/http"
)

func TestPracticeVoiceStreamsBeforeWorkerFinishes(t *testing.T) {
	const streamType = "application/vnd.angry-boss.pcm"
	const firstFrame = "\x02\x00\x00\x00\x01\x00"
	const finalFrame = "\x00\x00\x00\x00"
	release := make(chan struct{})
	worker := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Accept") != streamType {
			w.WriteHeader(http.StatusNotAcceptable)
			return
		}
		w.Header().Set("Content-Type", streamType)
		_, _ = io.WriteString(w, firstFrame)
		w.(http.Flusher).Flush()
		select {
		case <-release:
			_, _ = io.WriteString(w, finalFrame)
		case <-r.Context().Done():
		}
	}))
	defer worker.Close()
	defer close(release)
	catalog, err := game.LoadCatalog("../../../../scenarios")
	if err != nil {
		t.Fatal(err)
	}
	practice := game.NewPractice(catalog, nil)
	state, err := practice.Start("angry-boss")
	if err != nil {
		t.Fatal(err)
	}
	router := gin.New()
	transport.RegisterPracticeVoice(router.Group("/api/v1"), practice, worker.URL)
	server := httptest.NewServer(router)
	defer server.Close()

	req, err := http.NewRequest(http.MethodGet, server.URL+"/api/v1/sessions/"+state.ID+"/voice/0", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Accept", streamType)
	client := &http.Client{Timeout: 3 * time.Second}
	response, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK || response.Header.Get("Content-Type") != streamType {
		t.Fatalf("unexpected HTTP response: %s %v", response.Status, response.Header)
	}
	frame := make([]byte, len(firstFrame))
	if _, err := io.ReadFull(response.Body, frame); err != nil || string(frame) != firstFrame {
		t.Fatalf("first frame must arrive while worker is blocked: %q, %v", frame, err)
	}
}

func TestPracticeVoiceUsesSavedDialogueAndBossCues(t *testing.T) {
	catalog, err := game.LoadCatalog("../../../../scenarios")
	if err != nil {
		t.Fatal(err)
	}
	type speechRequest struct {
		ScenarioID string `json:"scenarioId"`
		Text       string `json:"text"`
	}
	forwarded := make(chan speechRequest, 1)
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
	voice := func(t *testing.T, router http.Handler, path, id, line string) {
		t.Helper()
		response := request(t, router, path, http.StatusOK)
		if response.Body.String() != "sample audio" || response.Header().Get("Content-Type") != "audio/wav" {
			t.Fatalf("unexpected audio response: %v %q", response.Header(), response.Body.String())
		}
		select {
		case got := <-forwarded:
			if got != (speechRequest{ScenarioID: id, Text: line}) {
				t.Fatalf("unexpected speech request: %+v", got)
			}
		default:
			t.Fatal("missing speech request")
		}
	}

	const sessions = "/api/v1/sessions"
	modes := []struct {
		name string
		ai   game.PracticeAI
	}{
		{name: "local"},
		{name: "ai", ai: game.MockPracticeAI{}},
	}
	for _, mode := range modes {
		t.Run(mode.name, func(t *testing.T) {
			practice := game.NewPractice(catalog, mode.ai)
			router := gin.New()
			api := router.Group("/api/v1")
			transport.RegisterPractice(api, practice)
			transport.RegisterPracticeVoice(api, practice, worker.URL)
			for _, id := range []string{"angry-boss", "demanding-client", "difficult-customer"} {
				t.Run(id, func(t *testing.T) {
					session := postSession(t, router, sessions, map[string]string{"scenarioId": id}, http.StatusCreated)
					path := sessions + "/" + session.ID
					voice(t, router, path+"/voice/0", id, session.Messages[0].Text)

					input := game.SubmitInput{RequestID: "reply", Text: "รับทราบค่ะ"}
					next := postSession(t, router, path+"/messages", input, http.StatusOK)
					request(t, router, path+"/voice/1", http.StatusNotFound)
					request(t, router, path+"/voice/3", http.StatusNotFound)
					request(t, router, path+"/voice/unknown", http.StatusNotFound)
					voice(t, router, path+"/voice/2?scenarioId=other&text=override", id, next.Messages[2].Text)
					if id != "angry-boss" {
						request(t, router, path+"/voice/reminder", http.StatusNotFound)
						return
					}

					voice(t, router, path+"/voice/interjection", id, "ขอเข้าประเด็นเลยครับ")
					voice(t, router, path+"/voice/takeover", id, "เดี๋ยวครับ ฟังผมก่อน ขอคำตอบสั้น ๆ ให้ตรงคำถามครับ")
					voice(t, router, path+"/voice/reminder", id, "ทำไมยังไม่ตอบครับ?")
					ended := postSession(t, router, path+"/hang-up", map[string]int{"turn": next.Turn}, http.StatusOK)
					request(t, router, path+"/voice/reminder", http.StatusNotFound)
					voice(t, router, path+"/voice/3", id, ended.Messages[3].Text)
					voice(t, router, path+"/voice/4", id, ended.Messages[4].Text)
				})
			}
		})
	}
}
