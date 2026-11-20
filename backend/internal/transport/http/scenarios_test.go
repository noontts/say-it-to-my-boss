package http_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"say-it-to-my-boss/backend/internal/game"
	transport "say-it-to-my-boss/backend/internal/transport/http"
)

func TestScenarioCatalog(t *testing.T) {
	wantIDs := []string{"angry-boss", "demanding-client", "difficult-customer"}
	dir := t.TempDir()
	for i, id := range wantIDs {
		data, err := os.ReadFile(filepath.Join("../../../../scenarios", id+".json"))
		if err != nil {
			t.Fatal(err)
		}
		// Reverse the filenames so directory order and scenario ID order differ.
		writeScenario(t, dir, wantIDs[len(wantIDs)-1-i]+".json", string(data))
	}
	router := scenarioRouter(t, dir)
	response := request(t, router, "/api/scenarios", http.StatusOK)

	var catalog struct {
		Scenarios []struct {
			game.Summary
			Turns json.RawMessage
		}
	}
	decode(t, response, &catalog)
	if len(catalog.Scenarios) != len(wantIDs) {
		t.Fatalf("got %d scenarios, want %d", len(catalog.Scenarios), len(wantIDs))
	}
	for i, scenario := range catalog.Scenarios {
		if scenario.ID != wantIDs[i] || scenario.Playable != (i == 0) ||
			scenario.Title == "" || scenario.Profession == "" || scenario.Description == "" || scenario.Turns != nil {
			t.Errorf("unexpected catalog entry %d: %+v", i, scenario)
		}
	}
}

func TestScenarioDetails(t *testing.T) {
	router := scenarioRouter(t, "../../../../scenarios")

	var playable game.Scenario
	decode(t, request(t, router, "/api/scenarios/angry-boss", http.StatusOK), &playable)
	if !playable.Playable || playable.ID != "angry-boss" || len(playable.Turns) != 3 {
		t.Fatalf("unexpected playable scenario: %+v", playable)
	}
	for _, turn := range playable.Turns {
		if turn.ID == "" || turn.Prompt == "" || len(turn.Choices) != 2 {
			t.Fatalf("unexpected turn: %+v", turn)
		}
		for _, choice := range turn.Choices {
			if choice.ID == "" || choice.Text == "" || choice.Reaction == "" || choice.Feedback == "" {
				t.Errorf("incomplete choice: %+v", choice)
			}
		}
	}

	var unavailable game.Scenario
	decode(t, request(t, router, "/api/scenarios/demanding-client", http.StatusOK), &unavailable)
	if unavailable.Playable || unavailable.ID != "demanding-client" ||
		unavailable.Turns == nil || len(unavailable.Turns) != 0 {
		t.Fatalf("unexpected unavailable scenario: %+v", unavailable)
	}
	request(t, router, "/api/scenarios/unknown", http.StatusNotFound)
}

func TestScenarioCatalogRejectsInvalidFiles(t *testing.T) {
	const metadata = `"id":"practice","title":"Title","profession":"Office","description":"Brief"`
	cases := []struct {
		name  string
		data  string
		first string
		want  string
	}{
		{name: "malformed JSON", data: "{", want: "decode scenario"},
		{name: "missing metadata", data: `{"id":"practice"}`, want: "title"},
		{name: "duplicate ID", data: "{" + metadata + "}", first: "{" + metadata + "}", want: "duplicate scenario id"},
		{name: "incomplete script", data: "{" + metadata + `,"turns":[]}`, want: "exactly 3 turns"},
		{
			name: "incomplete turn",
			data: "{" + metadata + `,"turns":[{"id":"one","prompt":"Prompt","choices":[]},{},{}]}`,
			want: "exactly 2 choices",
		},
		{
			name: "incomplete choice",
			data: "{" + metadata + `,"turns":[{"id":"one","prompt":"Prompt","choices":[{"id":"a","text":"Reply","reaction":"Reaction"},{}]},{},{}]}`,
			want: "feedback",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			if tc.first != "" {
				writeScenario(t, dir, "a.json", tc.first)
			}
			writeScenario(t, dir, "b.json", tc.data)

			_, err := game.LoadCatalog(dir)
			if err == nil || !strings.Contains(err.Error(), "b.json") || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("got error %v, want b.json and %q", err, tc.want)
			}
		})
	}
}

func TestEmptyScenarioCatalog(t *testing.T) {
	router := scenarioRouter(t, t.TempDir())
	response := request(t, router, "/api/scenarios", http.StatusOK)
	if response.Body.String() != `{"scenarios":[]}` {
		t.Fatalf("got %s, want an empty array", response.Body)
	}
}

func scenarioRouter(t *testing.T, dir string) *gin.Engine {
	t.Helper()
	catalog, err := game.LoadCatalog(dir)
	if err != nil {
		t.Fatal(err)
	}
	router := gin.New()
	transport.RegisterScenarios(router.Group("/api"), catalog)
	return router
}

func request(t *testing.T, router http.Handler, path string, status int) *httptest.ResponseRecorder {
	t.Helper()
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
	if response.Code != status {
		t.Fatalf("GET %s got %d, want %d: %s", path, response.Code, status, response.Body)
	}
	return response
}

func decode(t *testing.T, response *httptest.ResponseRecorder, target any) {
	t.Helper()
	if err := json.NewDecoder(response.Body).Decode(target); err != nil {
		t.Fatal(err)
	}
}

func writeScenario(t *testing.T, dir, name, data string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(data), 0600); err != nil {
		t.Fatal(err)
	}
}
