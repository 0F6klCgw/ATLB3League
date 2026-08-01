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

// Matches Clerk's UI to the site's own theme.css palette. Clerk's
// `variables` run through its own color parser (to derive hover/shade
// variants), which rejects `var(...)` — so these are the literal values
// of the corresponding theme.css custom properties, kept in sync by hand.
// `elements` below are plain style objects, not color-parsed, so those
// can reference the custom properties directly.
const CLERK_APPEARANCE = {
  variables: {
    colorPrimary: "#d9b45b",              // --gold
    colorBackground: "#15121f",           // --panel
    colorInputBackground: "#1c1828",      // --panel-2
    colorInputText: "#e8e2d4",            // --ink
    colorText: "#e8e2d4",                 // --ink
    colorTextSecondary: "#a79fb8",        // --ink-dim
    colorTextOnPrimaryBackground: "#1a1408",
    colorNeutral: "#a79fb8",              // --ink-dim
    colorDanger: "#e0605a",               // --bad
    colorSuccess: "#7fc09a",              // --good
    borderRadius: "11px",
    fontFamily: "system-ui, sans-serif",
  },
  elements: {
    card: { border: "1px solid var(--line-2)", boxShadow: "0 20px 44px rgba(0,0,0,.6)" },
    userButtonPopoverCard: { border: "1px solid var(--line-2)", boxShadow: "0 20px 44px rgba(0,0,0,.6)" },
    // The popover's action rows (icon + text) and its "Secured by Clerk"
    // footer badge aren't fully driven by `variables` above — Clerk's
    // automatic hover/footer shading assumes a light base theme, which
    // goes the wrong direction against our dark background (near-invisible
    // text/icons). Force them explicitly instead of relying on derivation.
    userButtonPopoverActionButton: { color: "var(--ink)" },
    userButtonPopoverActionButtonIcon: { color: "var(--ink-dim)" },
    userButtonPopoverActionButton__manageAccount: { "&:hover": { backgroundColor: "var(--panel-2)" } },
    userButtonPopoverActionButton__signOut: { "&:hover": { backgroundColor: "var(--panel-2)" } },
    userButtonPopoverFooter: { opacity: 1 },
    footer: { opacity: 1 },
    footerActionText: { color: "var(--ink-dim)" },
    poweredByClerkText: { color: "var(--ink-faint)" },
    internal: { opacity: 1 },
  },
};

async function initClerk(onRender){
  const Clerk = await waitForClerk();
  await Clerk.load({ appearance: CLERK_APPEARANCE });

  // Clerk.addListener fires on every resource change during init (client,
  // session, user each trigger their own call) — not just once. Mounting a
  // component on every fire stacks multiple instances into the same node,
  // each wired to its own submit handler (this is what was sending the
  // sign-in code email 3x). Guard every mount/unmount so it only happens
  // once per actual state transition.
  let userButtonMounted = false;

  function render(){
    const signedIn = !!Clerk.user;
    const userBtn = document.getElementById("clerkUserButton");
    if (userBtn){
      if (signedIn && !userButtonMounted){
        userBtn.classList.remove("hidden");
        Clerk.mountUserButton(userBtn);
        userButtonMounted = true;
      } else if (!signedIn && userButtonMounted){
        Clerk.unmountUserButton(userBtn);
        userButtonMounted = false;
        userBtn.innerHTML = "";
      }
    }
    if (typeof onRender === "function") onRender(Clerk, signedIn);
  }

  Clerk.addListener(render);
  render();
  return Clerk;
}
