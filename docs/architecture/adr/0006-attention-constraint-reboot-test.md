# Add an attention constraint reboot test

SDD Harness requires an attention constraint modeled after planning-with-files' reboot test, expanded for governed software delivery. Every run must persist enough state for an agent to recover the active project, architecture entry point, domain, architecture relationship, subfeature, stage, goal, learned facts, completed work, and allowed actions from files rather than conversation memory, so hooks and gates can prevent work from continuing when the agent is not properly oriented.
