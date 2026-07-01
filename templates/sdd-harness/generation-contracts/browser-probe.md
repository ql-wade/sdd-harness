# Browser Probeability Generation Contract

Apply this contract when the generated project has a browser UI or an active probe profile.

1. Production DOM must contain only product UI. Never inject probe scripts, ASCII dumps,
   result JSON, or debug DOM nodes into `index.html` or the rendered application.
2. Canvas layout size must come from the viewport or a stable external container.
   Never read the canvas `clientWidth`/`clientHeight` and write that value back to the
   same canvas or renderer sizing API.
3. Expose a non-DOM observation adapter as `globalThis.__sddProbe`.
   It must provide `snapshot()` returning a JSON-serializable state object.
4. For every `requiredInteractions` entry in the active probe profile, `snapshot()`
   must expose the before/after state needed by its `transitionContracts` assertion.
   UI automation performs the action; the adapter observes state and must not mutate it.
5. The adapter must not change layout, render visible content, log errors, or alter
   production behavior. It is an observation boundary, not a debug overlay.
6. Generate an automated regression test for every browser-specific invariant above.
   Canvas projects must invoke the actual resize controller and prove its sizing source
   is the viewport or an external container, never the canvas dimensions it writes.
   Tests of a detached aspect-ratio helper alone do not satisfy this requirement.
