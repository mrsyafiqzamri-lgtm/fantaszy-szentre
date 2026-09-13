FANTASZY SZENTRE PERSONAL — ONE-SHOT PATCH
13 September 2026

UPLOAD METHOD
1. Extract this ZIP.
2. Upload ALL contents to the ROOT of the existing fantaszy-szentre repository.
3. Preserve the folders exactly: .github/, scripts/, data/, assets/brand/.
4. Choose replace/overwrite for files with the same name.
5. Do NOT upload the ZIP itself into the repository as the website file.

WHAT THIS PATCH FIXES
- Removes the slow Free Hit boot gate/polling path.
- Canonical permanent squad reconstruction: a Free Hit squad can no longer feed My Team recommendations.
- Reconstructs already-made permanent transfers after the last locked baseline.
- KK Old Boys FC: GW3 Free Hit squad is ignored; permanent GW2 ownership is restored and the GW4 Shaw -> Konsa move is applied from transfer history.
- Same protection applies automatically to every owner team, not only KK Old Boys FC.
- Corrects purchase-price history by ignoring temporary Free Hit transfers.
- Free Transfers now reflect transfers already made for the upcoming GW.

PERFORMANCE
- Old startup: ~42 data requests / ~3.16 MB uncompressed JSON before page assets.
- New startup: 2 bundled data requests / ~1.14 MB uncompressed JSON.
- Players, Weekly and More are rendered lazily instead of all at startup.
- Match Predictions, Weekly Lab and freshness no longer run polling loops.
- Header/watermark PNG assets are resized and optimised without changing the official design.
- Google Fonts are non-blocking.

MONETISATION-GRADE FEATURES BROUGHT INTO PERSONAL MODE
- Decision-first GW Checklist: transfer, captain/VC, XI, bench, chip and 4GW outlook on one page.
- Safe / Balanced / Aggressive decision profile per team.
- Risk profile changes decision thresholds only; it does not alter raw SZxP.
- Verified Squad Source banner shows Free Hit reversion and permanent transfers applied.
- Current squad/bank planning uses reconstructed permanent ownership instead of a stale public picks snapshot.
- Existing 3.0 Commercial Core, Build 5 Scenario Portfolio, Match Predictions and model audit remain in place.

AUTOMATION
The hourly GitHub Action now rebuilds:
- data/web-core.json
- data/portfolio.json
So the fast/canonical architecture stays correct after future Gameweeks without another manual patch.
