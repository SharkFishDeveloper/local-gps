/* ------------------------------------------------------------------ */
/* DOM marker builders                                                  */
/* ------------------------------------------------------------------ */

function createPinElement(color: string): HTMLDivElement {
  const el = document.createElement("div");
  el.style.width = "30px";
  el.style.height = "40px";
  el.innerHTML = `
    <svg width="30" height="40" viewBox="0 0 30 40" xmlns="http://www.w3.org/2000/svg">
      <path d="M15 0C6.716 0 0 6.716 0 15c0 10.5 15 25 15 25s15-14.5 15-25C30 6.716 23.284 0 15 0z" fill="${color}"/>
      <circle cx="15" cy="15" r="5.5" fill="white"/>
    </svg>`;
  return el;
}

export default createPinElement;