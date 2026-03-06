const page = document.body.dataset.page;

const pageModules = {
  home: "./home-page.js",
  reader: "./reader-page.js",
  study: "./study-page.js",
};

async function bootstrap() {
  const modulePath = pageModules[page];

  if (!modulePath) {
    throw new Error(`Unknown page "${page ?? "undefined"}".`);
  }

  const module = await import(modulePath);

  if (typeof module.init !== "function") {
    throw new Error(`Page module "${modulePath}" does not export init().`);
  }

  await module.init();
}

void bootstrap().catch((error) => {
  console.error(error);
  const statusTarget = document.querySelector("#appStatus");

  if (statusTarget) {
    statusTarget.textContent = "The app could not finish loading.";
  }
});
