# Patch formatting

0004 is the exact Git-generated unified diff from the private six-patch baseline. Blank context lines contain the required single-space unified-diff marker. A repository-level whitespace scan of the patch file may report those markers as trailing whitespace. The actual changed upstream source passed `git diff --check HEAD`; code, test and report content have no such warnings. Do not trim patch context or change tested source/fingerprint merely to hide this representation. Original raw logs are unchanged; display-only ANSI/EOL whitespace normalization is separately hashed.
