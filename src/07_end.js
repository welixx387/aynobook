
/* ================= start ================= */
boot().catch(e => { console.error(e); showGate(); $('#gateBody').innerHTML = `<h2>Библиотека не открылась</h2><p>${esc(errText(e))}</p><button class="btn primary" onclick="location.reload()">Обновить страницу</button>`; });
})();
</script>
