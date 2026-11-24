package http_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"github.com/gin-gonic/gin"

	"say-it-to-my-boss/backend/internal/game"
	transport "say-it-to-my-boss/backend/internal/transport/http"
)

func TestAllScenariosFinishAndReplay(t *testing.T) {
	catalog, err := game.LoadCatalog("../../../../scenarios")
	if err != nil {
		t.Fatal(err)
	}
	router := gin.New()
	api := router.Group("/api/v1")
	transport.RegisterPracticeScenarios(api, catalog)
	transport.RegisterPractice(api, game.NewPractice(catalog, nil))

	var list struct{ Scenarios []game.Summary }
	decode(t, request(t, router, "/api/v1/scenarios", http.StatusOK), &list)
	answers := map[string][]string{
		"angry-boss": {
			"ขอโทษที่ส่งช้าค่ะ เพราะตัวเลขยังตรวจไม่เสร็จ ตอนนี้ทำสรุปแล้วค่ะ",
			"ขอส่งบทสรุปก่อนห้าโมงเย็นค่ะ",
			"จะส่งฉบับเต็มพรุ่งนี้แปดโมงค่ะ ถ้าติดขัดจะแจ้งภายในหนึ่งทุ่ม",
		},
		"demanding-client": {
			"เข้าใจว่าต้องเปิดตัววันจันทร์ค่ะ ทีมทำไฟล์ทั้งหมดไม่ทัน",
			"ส่งภาพหลักวันศุกร์ก่อนบ่ายสามโมงค่ะ",
			"ส่วนที่เหลือจะส่งภายในวันอังคาร และจะอัปเดตความคืบหน้าวันจันทร์ค่ะ",
		},
		"difficult-customer": {
			"ขอโทษที่คุณต้องเสียเวลานะคะ",
			"ตอนนี้พ้นกำหนดคืนเงินแล้วค่ะ",
			"ขอใบเสร็จเพื่อเช็กประกันและตรวจเครื่อง แล้วจะติดต่อแจ้งผลพรุ่งนี้ค่ะ",
		},
	}
	if len(list.Scenarios) != len(answers) {
		t.Fatalf("unexpected catalog: %+v", list)
	}
	for _, scenario := range list.Scenarios {
		t.Run(scenario.ID, func(t *testing.T) {
			turns, known := answers[scenario.ID]
			if !known || !scenario.Playable || scenario.Character == "" {
				t.Fatalf("unexpected catalog entry: %+v", scenario)
			}
			first := playLocal(t, router, scenario.ID, turns, "succeeded", 100)
			replay := playLocal(t, router, scenario.ID, []string{"อืม", "อืม", "อืม"}, "needs_practice", 0)
			if first.ID == replay.ID {
				t.Fatal("replay reused the previous session")
			}
		})
	}
}

func TestHangUpAfterSilence(t *testing.T) {
	catalog, err := game.LoadCatalog("../../../../scenarios")
	if err != nil {
		t.Fatal(err)
	}
	router := gin.New()
	transport.RegisterPractice(router.Group("/api/v1"), game.NewPractice(catalog, nil))

	const sessions = "/api/v1/sessions"
	session := postSession(t, router, sessions, map[string]string{"scenarioId": "angry-boss"}, http.StatusCreated)
	path := sessions + "/" + session.ID
	answer := game.SubmitInput{RequestID: "first", Turn: 0, Text: "ขอโทษค่ะ เพราะยังตรวจตัวเลขอยู่ ตอนนี้สรุปพร้อมแล้วค่ะ"}
	progress := postSession(t, router, path+"/messages", answer, http.StatusOK)
	postSession(t, router, path+"/hang-up", map[string]int{"turn": 0}, http.StatusConflict)

	input := map[string]int{"turn": 1}
	ended := postSession(t, router, path+"/hang-up", input, http.StatusOK)
	if ended.EndReason != "silence" || ended.Status != "needs_practice" || ended.Turn != progress.Turn ||
		ended.Trust != progress.Trust || !reflect.DeepEqual(ended.Achieved, progress.Achieved) ||
		len(ended.Messages) != len(progress.Messages)+2 ||
		!reflect.DeepEqual(ended.Messages[len(progress.Messages):], []game.Message{
			{Role: "npc", Text: "ทำไมยังไม่ตอบครับ?"},
			{Role: "npc", Text: "งั้นไว้ค่อยคุยกันครับ"},
		}) {
		t.Fatalf("unexpected hang-up state: %+v", ended)
	}
	if retry := postSession(t, router, path+"/hang-up", input, http.StatusOK); !reflect.DeepEqual(ended, retry) {
		t.Fatalf("retry changed the transcript: %+v", retry)
	}
	postSession(t, router, path+"/messages", game.SubmitInput{RequestID: "late", Turn: 1, Text: "ขอตอบค่ะ"}, http.StatusConflict)
	finished := postSession(t, router, path+"/finish", nil, http.StatusOK)
	if finished.Results == nil || finished.Results.ObjectiveCompletion == 0 {
		t.Fatalf("coaching did not include completed practice: %+v", finished)
	}
}

func playLocal(t *testing.T, router http.Handler, id string, turns []string, outcome string, objectiveScore int) game.Session {
	t.Helper()
	session := postSession(t, router, "/api/v1/sessions", map[string]string{"scenarioId": id}, http.StatusCreated)
	if session.Status != "active" || session.Trust != 50 || len(session.Messages) != 1 ||
		session.TurnLimit != len(turns) || session.Results != nil {
		t.Fatalf("session did not start fresh: %+v", session)
	}
	path := "/api/v1/sessions/" + session.ID
	for i, text := range turns {
		postSession(t, router, path+"/messages", game.SubmitInput{RequestID: fmt.Sprint(i), Turn: i, Text: text}, http.StatusOK)
	}
	finished := postSession(t, router, path+"/finish", nil, http.StatusOK)
	if finished.Status != outcome || finished.Results == nil || finished.Results.ObjectiveCompletion != objectiveScore ||
		len(finished.Results.Scores) != 4 || len(finished.Results.Suggestions) == 0 || len(finished.Messages) != 2*len(turns)+1 {
		t.Fatalf("unexpected result: %+v (%+v)", finished, finished.Results)
	}
	var reloaded game.Session
	decode(t, request(t, router, path, http.StatusOK), &reloaded)
	if !reflect.DeepEqual(finished, reloaded) {
		t.Fatal("reloading changed the outcome or coaching")
	}
	return finished
}

func postSession(t *testing.T, router http.Handler, path string, body any, status int) game.Session {
	t.Helper()
	data, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodPost, path, bytes.NewReader(data)))
	if response.Code != status {
		t.Fatalf("POST %s got %d, want %d: %s", path, response.Code, status, response.Body)
	}
	if !json.Valid(response.Body.Bytes()) {
		t.Fatalf("POST %s returned invalid JSON: %s", path, response.Body)
	}
	var session game.Session
	decode(t, response, &session)
	return session
}

func TestOfficeEntrySession(t *testing.T) {
	catalog, err := game.LoadCatalog("../../../../scenarios")
	if err != nil {
		t.Fatal(err)
	}
	router := gin.New()
	transport.RegisterPractice(router.Group("/api/v1"), game.NewPractice(catalog, nil))
	session := postSession(t, router, "/api/v1/sessions", map[string]string{"scenarioId": "angry-boss", "officeEntry": "answer"}, http.StatusCreated)
	if session.OfficeEntry != "answer" || session.Trust != 50 || session.Mood != "concerned" || session.Turn != 0 || len(session.Achieved) != 0 || len(session.Messages) != 1 {
		t.Fatalf("unexpected initial session: %+v", session)
	}
	legacy := postSession(t, router, "/api/v1/sessions", map[string]string{"scenarioId": "angry-boss"}, http.StatusCreated)
	if legacy.OfficeEntry != "" || legacy.Trust != session.Trust || legacy.Messages[0] != session.Messages[0] {
		t.Fatalf("answer changed the usual opening or trust: %+v", session)
	}
	var restored game.Session
	decode(t, request(t, router, "/api/v1/sessions/"+session.ID, http.StatusOK), &restored)
	if restored.OfficeEntry != "answer" {
		t.Fatalf("entry not persisted: %+v", restored)
	}
	for _, input := range []map[string]string{{"scenarioId": "angry-boss", "officeEntry": "invalid"}, {"scenarioId": "demanding-client", "officeEntry": "answer"}, {"scenarioId": "angry-boss", "officeEntry": ""}} {
		postSession(t, router, "/api/v1/sessions", input, http.StatusBadRequest)
	}
}

func TestOfficeCallbackCanRecoverTrust(t *testing.T) {
	catalog, err := game.LoadCatalog("../../../../scenarios")
	if err != nil {
		t.Fatal(err)
	}
	router := gin.New()
	transport.RegisterPractice(router.Group("/api/v1"), game.NewPractice(catalog, nil))
	session := postSession(t, router, "/api/v1/sessions", map[string]string{"scenarioId": "angry-boss", "officeEntry": "callback"}, http.StatusCreated)
	const opening = "เมื่อกี้ผมโทรไปแล้วคุณไม่ได้รับสาย ตอนนี้รายงานไปถึงไหนแล้วครับ?"
	if session.OfficeEntry != "callback" || session.Trust != 35 || session.Mood != "frustrated" || session.Turn != 0 || len(session.Achieved) != 0 || len(session.Messages) != 1 || session.Messages[0].Text != opening {
		t.Fatalf("unexpected initial callback: %+v", session)
	}
	path := "/api/v1/sessions/" + session.ID
	var restored game.Session
	decode(t, request(t, router, path, http.StatusOK), &restored)
	if restored.OfficeEntry != session.OfficeEntry || restored.Trust != session.Trust || restored.Messages[0].Text != opening {
		t.Fatalf("unexpected restored callback: %+v", restored)
	}
	for turn, reply := range []string{
		"ขอโทษที่ส่งช้าค่ะ เพราะตัวเลขยังตรวจไม่เสร็จ ตอนนี้ทำสรุปแล้วค่ะ",
		"ขอส่งบทสรุปก่อนห้าโมงเย็นค่ะ",
		"จะส่งฉบับเต็มพรุ่งนี้แปดโมงค่ะ ถ้าติดขัดจะแจ้งภายในหนึ่งทุ่ม",
	} {
		session = postSession(t, router, path+"/messages", map[string]any{
			"requestId": fmt.Sprintf("callback-%d", turn), "turn": turn, "text": reply,
		}, http.StatusOK)
	}
	if session.Status != "succeeded" || session.Trust < 50 || len(session.Achieved) != 3 {
		t.Fatalf("callback did not recover trust: %+v", session)
	}
}
