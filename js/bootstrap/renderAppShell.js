const APP_SHELL = `
  <div id="app">
    <div id="account" class="screen"></div>
    <div id="profileSelection" class="screen"></div>
    <div id="home" class="screen"></div>
    <div id="detail" class="screen"></div>
    <div id="stream" class="screen"></div>
    <div id="castDetail" class="screen"></div>
    <div id="catalogSeeAll" class="screen"></div>
    <div id="library" class="screen"></div>
    <div id="search" class="screen"></div>
    <div id="discover" class="screen"></div>
    <div id="settings" class="screen"></div>
    <div id="plugin" class="screen"></div>
    <div id="catalogOrder" class="screen"></div>
    <div id="player" class="screen">
      <video id="videoPlayer" autoplay playsinline webkit-playsinline preload="auto" style="width:100vw;height:100vh;background:black"></video>
      <object id="avplayPlayer" type="application/avplayer" style="position:absolute;left:0;top:0;width:100vw;height:100vh;display:none;"></object>
    </div>
  </div>
`;

export function renderAppShell() {
  if (document.getElementById("app")) {
    return;
  }
  document.body.insertAdjacentHTML("afterbegin", APP_SHELL);
}
