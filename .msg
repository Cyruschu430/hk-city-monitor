docs: plan for the next phase, with the measurements that revise the work order

Written from DOM and payload measurements rather than from the documents.

Two real bugs were found and fixed first (committed separately): CSDI
publishes district names with a trailing CRLF, which silently prevented an
affected district from ever highlighting; and the LAYERS control only ever
listed vertical layers, so a layer switched on from the rail was invisible
and unswitchable from the map's own control.

Three WORK_ORDER items are revised as a result:
- Section 4 (fill panel.group) is obsolete: the tabs correctly derive from
  each SOURCE's group field, so filling panel.group would do nothing.
- Section 5 item 2 (rail layer ids do not match layers.json, icons fall back
  to a globe) does not hold: the six layer icons are all distinct, and only
  the two MODES use the fallback, which is correct for them.
- Section 5 item 1 (freshness driven by one source) is already fixed
  system-wide.

What is genuinely left: the 105 orphan sources, four stale panels whose cause
is not yet established, the station/wind visual overlap, and the four steps
that need Cyrus (wrangler login, the AIS key, the hourly collector schedule,
and the editorial decision about political news content).

The plan states plainly what was NOT done, so the next session does not
assume it was.
