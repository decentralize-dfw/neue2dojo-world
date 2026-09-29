(function () {
  var page = document.querySelector('.page')
  if (!page) return
  var width = +page.getAttribute('data-width') || 980
  function fit() {
    var scale = Math.min(1, document.documentElement.clientWidth / width)
    page.style.zoom = scale < 1 ? scale : ''
    page.style.width = scale < 1 ? (100 / scale) + '%' : ''
  }
  fit()
  window.addEventListener('resize', fit)
})()
