package game

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
)

type Summary struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Profession  string `json:"profession"`
	Character   string `json:"character,omitempty"`
	Description string `json:"description"`
	Playable    bool   `json:"playable"`
}

type Scenario struct {
	Summary
	Turns    []Turn        `json:"turns"`
	Practice *PracticeSpec `json:"-"`
}

type Turn struct {
	ID      string   `json:"id"`
	Prompt  string   `json:"prompt"`
	Choices []Choice `json:"choices"`
}

type Choice struct {
	ID       string `json:"id"`
	Text     string `json:"text"`
	Reaction string `json:"reaction"`
	Feedback string `json:"feedback"`
}

type Catalog struct {
	byID map[string]Scenario
	ids  []string
}

func LoadCatalog(dir string) (*Catalog, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("read scenario directory: %w", err)
	}

	catalog := &Catalog{byID: make(map[string]Scenario)}
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		path := filepath.Join(dir, entry.Name())
		scenario, err := loadScenario(path)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", path, err)
		}
		if _, exists := catalog.byID[scenario.ID]; exists {
			return nil, fmt.Errorf("%s: duplicate scenario id %q", path, scenario.ID)
		}
		catalog.byID[scenario.ID] = scenario
		catalog.ids = append(catalog.ids, scenario.ID)
	}
	slices.Sort(catalog.ids)
	return catalog, nil
}

func (catalog *Catalog) List() []Summary {
	summaries := make([]Summary, 0, len(catalog.ids))
	for _, id := range catalog.ids {
		summaries = append(summaries, catalog.byID[id].Summary)
	}
	return summaries
}

func (catalog *Catalog) ListPractice() []Summary {
	summaries := catalog.List()
	for i, summary := range summaries {
		summaries[i].Playable = catalog.byID[summary.ID].Practice != nil
	}
	return summaries
}

func (catalog *Catalog) Get(id string) (Scenario, bool) {
	scenario, exists := catalog.byID[id]
	return scenario, exists
}

func loadScenario(path string) (Scenario, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return Scenario{}, err
	}
	var file struct {
		Summary
		Turns    json.RawMessage `json:"turns"`
		Practice *PracticeSpec   `json:"practice"`
	}
	if err := json.Unmarshal(data, &file); err != nil {
		return Scenario{}, fmt.Errorf("decode scenario: %w", err)
	}
	if err := requireText(
		"id", file.ID, "title", file.Title, "profession", file.Profession, "description", file.Description,
	); err != nil {
		return Scenario{}, err
	}
	if strings.ContainsAny(file.ID, "/\\?#%") || strings.TrimSpace(file.ID) != file.ID ||
		file.ID == "." || file.ID == ".." {
		return Scenario{}, fmt.Errorf("invalid scenario id %q", file.ID)
	}

	scenario := Scenario{Summary: file.Summary, Turns: []Turn{}, Practice: file.Practice}
	if file.Practice != nil {
		if err := file.Practice.validate(); err != nil {
			return Scenario{}, fmt.Errorf("invalid practice: %w", err)
		}
	}
	scenario.Playable = file.Turns != nil
	if scenario.Playable {
		if err := json.Unmarshal(file.Turns, &scenario.Turns); err != nil {
			return Scenario{}, fmt.Errorf("decode turns: %w", err)
		}
		if err := validateTurns(scenario.Turns); err != nil {
			return Scenario{}, err
		}
	}
	return scenario, nil
}

func validateTurns(turns []Turn) error {
	if len(turns) != 3 {
		return fmt.Errorf("script must have exactly 3 turns")
	}
	turnIDs := make(map[string]bool, len(turns))
	for i, turn := range turns {
		if err := requireText("id", turn.ID, "prompt", turn.Prompt); err != nil {
			return fmt.Errorf("turn %d: %w", i+1, err)
		}
		if turnIDs[turn.ID] {
			return fmt.Errorf("duplicate turn id %q", turn.ID)
		}
		turnIDs[turn.ID] = true

		if len(turn.Choices) != 2 {
			return fmt.Errorf("turn %q must have exactly 2 choices", turn.ID)
		}
		for j, choice := range turn.Choices {
			if err := requireText(
				"id", choice.ID, "text", choice.Text, "reaction", choice.Reaction, "feedback", choice.Feedback,
			); err != nil {
				return fmt.Errorf("turn %q choice %d: %w", turn.ID, j+1, err)
			}
		}
		if turn.Choices[0].ID == turn.Choices[1].ID {
			return fmt.Errorf("turn %q has duplicate choice id %q", turn.ID, turn.Choices[0].ID)
		}
	}
	return nil
}

func requireText(nameValuePairs ...string) error {
	for i := 0; i < len(nameValuePairs); i += 2 {
		if strings.TrimSpace(nameValuePairs[i+1]) == "" {
			return fmt.Errorf("%s is required", nameValuePairs[i])
		}
	}
	return nil
}
