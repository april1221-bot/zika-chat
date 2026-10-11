/* ============================================================
   网易云音乐悬浮窗（APlayer + MetingJS API）
   - 入口：输入区"更多"菜单 → "网易音乐"
   - 点击后弹出可拖拽悬浮窗，内嵌 APlayer 播放器
   - 通过 MetingJS API (api.injahow.cn) 解析网易云歌单
   - 支持切换预设歌单、自定义歌单ID
   - 位置记忆在 localStorage（key: nm_widget_pos）
   ============================================================ */

(function () {
    'use strict';

    var STORAGE_KEY   = 'nm_widget_pos';
    var PLAYLIST_KEY  = 'nm_playlist_id';
    var METING_API    = 'https://api.injahow.cn/meting/';

    // 预设歌单
    var PRESETS = [
        { id: '3778678',    label: '热歌榜' },
        { id: '1972379',    label: '飙升榜' },
        { id: '3779629',    label: '新歌榜' },
        { id: '7183862422', label: 'ACG榜' },
        { id: '9913195',    label: '古典榜' },
        { id: 'custom',    label: '自定义歌单…' }
    ];

    var widget       = null;
    var selectEl     = null;
    var customPopup  = null;
    var customInput  = null;
    var overlayEl    = null;
    var aplayer      = null;     // APlayer 实例
    var currentLoadId = null;    // 当前正在加载的歌单 ID（用于取消过期请求）

    // ── 显示加载状态 ──
    function showLoading() {
        if (!overlayEl) return;
        overlayEl.innerHTML =
            '<div class="nm-spinner"></div>' +
            '<div class="nm-overlay-text">正在加载歌单…</div>';
        overlayEl.classList.remove('nm-hidden');
    }

    // ── 显示错误状态 ──
    function showError(msg, retryFn) {
        if (!overlayEl) return;
        var retryHTML = retryFn
            ? '<button class="nm-retry-btn">重试</button>'
            : '';
        overlayEl.innerHTML =
            '<div class="nm-overlay-text">' + (msg || '加载失败') + '</div>' +
            retryHTML;
        overlayEl.classList.remove('nm-hidden');
        if (retryFn) {
            var btn = overlayEl.querySelector('.nm-retry-btn');
            if (btn) btn.addEventListener('click', retryFn);
        }
    }

    // ── 隐藏覆盖层 ──
    function hideOverlay() {
        if (overlayEl) overlayEl.classList.add('nm-hidden');
    }

    // ── 获取歌单数据 ──
    function fetchPlaylist(playlistId, callback) {
        var url = METING_API + '?type=playlist&id=' + encodeURIComponent(playlistId);
        fetch(url)
            .then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            })
            .then(function (data) {
                if (!Array.isArray(data) || data.length === 0) {
                    throw new Error('空歌单');
                }
                // MetingJS 返回的字段：name, artist, url, pic, lrc
                // APlayer 需要：          name, artist, url, cover, lrc
                var audioList = data.map(function (item) {
                    return {
                        name:   item.name   || '未知',
                        artist: item.artist || '未知',
                        url:    item.url,
                        cover:  item.pic,
                        lrc:    item.lrc
                    };
                });
                callback(null, audioList);
            })
            .catch(function (err) {
                callback(err);
            });
    }

    // ── 加载并播放歌单 ──
    function loadPlaylist(playlistId) {
        if (!playlistId || playlistId === 'custom') {
            if (customPopup) customPopup.classList.add('nm-show');
            if (customInput) customInput.focus();
            return;
        }
        if (customPopup) customPopup.classList.remove('nm-show');
        localStorage.setItem(PLAYLIST_KEY, playlistId);

        // 检查 APlayer 库是否加载
        if (typeof APlayer === 'undefined') {
            showError('播放器组件加载失败，请检查网络', function () {
                loadPlaylist(playlistId);
            });
            return;
        }

        showLoading();
        var thisLoadId = playlistId + '_' + Date.now();
        currentLoadId = thisLoadId;

        fetchPlaylist(playlistId, function (err, audioList) {
            // 如果已经切换到别的歌单了，忽略结果
            if (currentLoadId !== thisLoadId) return;
            if (err) {
                showError('歌单加载失败：' + (err.message || '网络错误'), function () {
                    loadPlaylist(playlistId);
                });
                return;
            }

            // 销毁旧播放器
            if (aplayer) {
                try { aplayer.destroy(); } catch (e) {}
                aplayer = null;
            }

            var container = document.getElementById('nm-aplayer');
            if (container) container.innerHTML = '';

            // 创建新播放器
            try {
                aplayer = new APlayer({
                    container: container,
                    mini: false,
                    fixed: false,
                    autoplay: false,
                    theme: '#C20C0C',
                    loop: 'all',
                    order: 'list',
                    preload: 'metadata',
                    volume: 0.7,
                    mutex: true,
                    listFolded: false,
                    listMaxHeight: '260px',
                    lrcType: 3,
                    audio: audioList
                });
                hideOverlay();
            } catch (e) {
                showError('播放器初始化失败', function () {
                    loadPlaylist(playlistId);
                });
            }
        });
    }

    // ── 创建 DOM ──
    function createWidget() {
        if (widget) return;

        widget = document.createElement('div');
        widget.id = 'netease-music-widget';
        widget.innerHTML =
            '<div class="nm-header">' +
                '<span class="nm-header-icon"><i class="fas fa-music"></i></span>' +
                '<span class="nm-header-title">网易云音乐</span>' +
                '<span class="nm-header-btns">' +
                    '<button class="nm-header-btn nm-btn-min" title="最小化"><i class="fas fa-minus"></i></button>' +
                    '<button class="nm-header-btn nm-btn-close" title="关闭"><i class="fas fa-times"></i></button>' +
                '</span>' +
            '</div>' +
            '<div class="nm-body">' +
                '<div id="nm-aplayer"></div>' +
                '<div class="nm-overlay nm-hidden"></div>' +
            '</div>' +
            '<div class="nm-footer">' +
                '<div style="position:relative;flex:1;min-width:0;">' +
                    '<select class="nm-playlist-select">' +
                        PRESETS.map(function (p) {
                            return '<option value="' + p.id + '">' + p.label + '</option>';
                        }).join('') +
                    '</select>' +
                    '<div class="nm-custom-popup">' +
                        '<label>输入网易云歌单 ID</label>' +
                        '<div class="nm-custom-input-row">' +
                            '<input type="text" placeholder="如 7183862422" maxlength="20" />' +
                            '<button type="button">播放</button>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
                '<button class="nm-open-full" title="在网易云网页版使用心动推荐">' +
                    '<i class="fas fa-external-link-alt"></i> 完整版' +
                '</button>' +
            '</div>';

        document.body.appendChild(widget);

        selectEl     = widget.querySelector('.nm-playlist-select');
        customPopup   = widget.querySelector('.nm-custom-popup');
        customInput   = widget.querySelector('.nm-custom-popup input');
        overlayEl    = widget.querySelector('.nm-overlay');
        var customBtn = widget.querySelector('.nm-custom-popup button');

        // ── 关闭 ──
        widget.querySelector('.nm-btn-close').addEventListener('click', function (e) {
            e.stopPropagation();
            closeWidget();
        });

        // ── 最小化/恢复 ──
        widget.querySelector('.nm-btn-min').addEventListener('click', function (e) {
            e.stopPropagation();
            widget.classList.toggle('nm-minimized');
            var icon = this.querySelector('i');
            if (widget.classList.contains('nm-minimized')) {
                icon.className = 'fas fa-expand-alt';
            } else {
                icon.className = 'fas fa-minus';
            }
        });

        // ── 歌单切换 ──
        selectEl.addEventListener('change', function () {
            loadPlaylist(this.value);
        });

        // ── 自定义歌单 ──
        if (customBtn) {
            customBtn.addEventListener('click', function () {
                var val = (customInput.value || '').trim();
                if (!/^\d+$/.test(val)) {
                    if (typeof showNotification === 'function') {
                        showNotification('请输入数字歌单 ID', 'info', 2000);
                    }
                    return;
                }
                loadPlaylist(val);
                if (typeof showNotification === 'function') {
                    showNotification('正在加载自定义歌单…', 'info', 1500);
                }
            });
        }
        if (customInput) {
            customInput.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    if (customBtn) customBtn.click();
                }
            });
        }

        // ── 打开完整版 ──
        widget.querySelector('.nm-open-full').addEventListener('click', function () {
            window.open('https://music.163.com/#/my/m/music/playlist', '_blank');
        });

        // ── 拖拽 ──
        initDrag();

        // ── 恢复上次位置 ──
        restorePosition();

        // ── 加载上次歌单 ──
        var savedPlaylist = localStorage.getItem(PLAYLIST_KEY) || '3778678';
        selectEl.value = savedPlaylist;
        loadPlaylist(savedPlaylist);
    }

    // ── 拖拽逻辑（鼠标 + 触摸） ──
    function initDrag() {
        var header = widget.querySelector('.nm-header');
        var isDragging = false;
        var startX = 0, startY = 0;
        var origLeft = 0, origTop = 0;

        function onDown(clientX, clientY) {
            isDragging = true;
            startX = clientX;
            startY = clientY;
            var rect = widget.getBoundingClientRect();
            origLeft = rect.left;
            origTop  = rect.top;
            widget.style.left = origLeft + 'px';
            widget.style.top  = origTop + 'px';
            widget.style.right  = 'auto';
            widget.style.bottom = 'auto';
        }

        function onMove(clientX, clientY) {
            if (!isDragging) return;
            var dx = clientX - startX;
            var dy = clientY - startY;
            var newLeft = origLeft + dx;
            var newTop  = origTop  + dy;

            var w = widget.offsetWidth;
            var h = widget.offsetHeight;
            newLeft = Math.max(-w + 80, Math.min(window.innerWidth - 80, newLeft));
            newTop  = Math.max(0, Math.min(window.innerHeight - 40, newTop));

            widget.style.left = newLeft + 'px';
            widget.style.top  = newTop  + 'px';
        }

        function onUp() {
            if (!isDragging) return;
            isDragging = false;
            var left = parseInt(widget.style.left, 10) || 0;
            var top  = parseInt(widget.style.top, 10)  || 0;
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ left: left, top: top }));
        }

        // 鼠标
        header.addEventListener('mousedown', function (e) {
            if (e.target.closest('.nm-header-btn')) return;
            onDown(e.clientX, e.clientY);
            e.preventDefault();
        });
        document.addEventListener('mousemove', function (e) { onMove(e.clientX, e.clientY); });
        document.addEventListener('mouseup', onUp);

        // 触摸
        header.addEventListener('touchstart', function (e) {
            if (e.target.closest('.nm-header-btn')) return;
            var t = e.touches[0];
            onDown(t.clientX, t.clientY);
        }, { passive: true });
        document.addEventListener('touchmove', function (e) {
            if (!isDragging) return;
            var t = e.touches[0];
            onMove(t.clientX, t.clientY);
            e.preventDefault();
        }, { passive: false });
        document.addEventListener('touchend', onUp);
    }

    // ── 恢复位置 ──
    function restorePosition() {
        var saved = null;
        try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (e) {}
        if (saved && typeof saved.left === 'number' && typeof saved.top === 'number') {
            var left = Math.max(-widget.offsetWidth + 80, Math.min(window.innerWidth - 80, saved.left));
            var top  = Math.max(0, Math.min(window.innerHeight - 40, saved.top));
            widget.style.left = left + 'px';
            widget.style.top  = top  + 'px';
            widget.style.right  = 'auto';
            widget.style.bottom = 'auto';
        } else {
            widget.style.right  = '16px';
            widget.style.bottom = '80px';
            widget.style.left   = 'auto';
            widget.style.top    = 'auto';
        }
    }

    // ── 打开 ──
    function openWidget() {
        if (!widget) createWidget();
        restorePosition();
        widget.classList.add('nm-visible');
    }

    // ── 关闭 ──
    function closeWidget() {
        if (!widget) return;
        widget.classList.remove('nm-visible');
    }

    // ── 切换 ──
    function toggleWidget() {
        if (widget && widget.classList.contains('nm-visible')) {
            closeWidget();
        } else {
            openWidget();
        }
    }

    // ── 注册到更多菜单 ──
    document.addEventListener('DOMContentLoaded', function () {
        if (window.MoreMenu && typeof window.MoreMenu.registerItem === 'function') {
            window.MoreMenu.registerItem('netease-music', { ready: true, action: openWidget });
        }
    });

    window.NeteaseMusic = {
        open: openWidget,
        close: closeWidget,
        toggle: toggleWidget
    };
})();