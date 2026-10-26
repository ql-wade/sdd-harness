// fixture: scanned source replays a first-party route (interception anti-pattern)
async function replayRoute(page) {
  await page.route('**/fixture/state', (route) => route.fulfill({ status: 200 }));
}
module.exports = { replayRoute };
