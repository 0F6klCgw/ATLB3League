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

async function initClerk(onRender){
  const Clerk = await waitForClerk();
  await Clerk.load();

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
