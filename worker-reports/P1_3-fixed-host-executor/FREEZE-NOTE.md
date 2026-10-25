# Checkpoint freeze provenance

An initial portable-metadata assertion found npm CLI argv paths not covered by the Node-bin token. The shell sequence did not stop on that assertion, so intermediate commit b02884990883916258e19a413aa92fe6dea28a5f was created before the manifest. That commit is retained; it is not the final review candidate. No source/test result or raw log was altered.

This followup adds the explicitly declared <node24.15-package> metadata token and final hash manifest. Dependent freeze mutations now run only after successful validation. Final source remains the35/52 checkpoint; production entry/nonGate/resolve/actual qualification remains unimplemented/unaccepted here.
