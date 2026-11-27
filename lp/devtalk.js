// 開発こぼれ話の吹き出し：本文を1行にたたみ、「続きを読む」で全文を出す。
// 1行に収まる吹き出し（広い画面など）には「続きを読む」を出さない。
(function () {
  var en = document.documentElement.lang === "en";
  var label = en ? ["Read more", "Show less"] : ["続きを読む", "閉じる"];
  var bubbles = [].slice.call(document.querySelectorAll(".bubble"));
  bubbles.forEach(function (bb) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "bubble-more";
    btn.setAttribute("aria-expanded", "false");
    btn.innerHTML = '<span class="m">' + label[0] + '</span><span class="c">' + label[1] + "</span>";
    btn.addEventListener("click", function () {
      var open = bb.classList.toggle("open");
      btn.setAttribute("aria-expanded", String(open));
    });
    bb.appendChild(btn);
    bb.classList.add("fold");
  });
  function fit() {
    bubbles.forEach(function (bb) {
      if (bb.classList.contains("open")) return;
      var tx = bb.querySelector(".tx");
      bb.querySelector(".bubble-more").hidden = tx.scrollHeight <= tx.clientHeight + 1;
    });
  }
  var timer = 0;
  window.addEventListener("resize", function () { clearTimeout(timer); timer = setTimeout(fit, 150); });
  fit();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
})();
