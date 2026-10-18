// внутри приложения (в окне) прячем навигацию между документами
if (/[?&]embed=1/.test(location.search)) document.documentElement.classList.add('embed');
