// Whether builds that cannot take a licence lock the Pro tools (ADR-544): the
// web app, Preview and other free desktop builds. Until sales open it stays
// false, so nobody loses a tool before Pro can be bought; the launch change
// that enables checkout flips it. A commercial desktop build locks Pro without
// a licence either way (ADR-540).
export const UNLICENSED_BUILDS_RUN_FREE = false;

export const DESKTOP_DOWNLOAD_URL = 'https://kerfdesk.com/download.html';
