/* Shared Clerk bootstrap. Loads Clerk and keeps #clerkUserButton (in the
   nav) in sync with the signed-in state on every page. Pages that need to
   gate content behind sign-in (formsubmission.html) pass an onRender
   callback for their own extra logic; pages that just want the profile
   icon (index.html) can call initClerk() with no arguments. */
function waitForClerk(){
  return new Promise(resolve => {
    if (window.Clerk) return resolve(window.Clerk);
    const t = setInterval(() => { if (window.Clerk){ clearInterval(t); resolve(window.Clerk); } }, 50);
  });
}

// Matches Clerk's UI to the site's own theme.css tokens rather than
// hardcoding colors here a second time — these resolve as normal CSS
// custom properties since Clerk mounts into the same document.
const CLERK_APPEARANCE = {
  variables: {
    colorPrimary: "var(--gold)",
    colorBackground: "var(--panel)",
    colorInputBackground: "var(--panel-2)",
    colorInputText: "var(--ink)",
    colorText: "var(--ink)",
    colorTextSecondary: "var(--ink-dim)",
    colorTextOnPrimaryBackground: "#1a1408",
    colorNeutral: "var(--ink-dim)",
    colorDanger: "var(--bad)",
    colorSuccess: "var(--good)",
    borderRadius: "11px",
    fontFamily: "system-ui, sans-serif",
  },
  elements: {
    card: { border: "1px solid var(--line-2)", boxShadow: "0 20px 44px rgba(0,0,0,.6)" },
    userButtonPopoverCard: { border: "1px solid var(--line-2)", boxShadow: "0 20px 44px rgba(0,0,0,.6)" },
  },
};

async function initClerk(onRender){
  const Clerk = await waitForClerk();
  await Clerk.load({ appearance: CLERK_APPEARANCE });

  function render(){
    const signedIn = !!Clerk.user;
    const userBtn = document.getElementById("clerkUserButton");
    if (userBtn){
      if (signedIn){
        userBtn.classList.remove("hidden");
        Clerk.mountUserButton(userBtn);
      } else {
        userBtn.innerHTML = "";
      }
    }
    if (typeof onRender === "function") onRender(Clerk, signedIn);
  }

  Clerk.addListener(render);
  render();
  return Clerk;
}
