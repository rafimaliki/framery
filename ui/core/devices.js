// Device sizes, shared by the server (src/layout.mjs) and the studio (the player).
// phone, tablet, desktop: a real screen of that device only. document: anything else (a spec, a gallery, a token
// sheet), at a fixed width with its height measured from the page.
export const DEVICES = { phone: [390, 844], tablet: [820, 1180], desktop: [1280, 800], document: [960, 1200] };
