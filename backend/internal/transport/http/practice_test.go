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
	var session game.Session
	decode(t, response, &session)
	return session
}
