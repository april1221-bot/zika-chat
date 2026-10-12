/* ============================================================
   状态探测 (status-probe) v3
   - 三项5格信号：链接强弱 / 他的状态 / 他有空吗
   - 位置感知：感知一下按钮 + 顶部气泡弹窗 + 位置时间线
   - 当天首次进入：三项全刷
   - 之后：每项独立计时（刷新时确定下次间隔，在 min~max 之间随机）
   - 手动"重新探测"：一个按钮刷三项，15分钟CD
   - "感知一下"：随机位置文案，独立15分钟CD，顶部气泡提示
   - 不加后台定时器：刷新只在进入页面/打开modal时懒触发
   - 不影响导入导出：数据存 localStorage，backup-engine 全量收集
   ============================================================ */

(function () {
    const STORAGE_KEY = 'statusProbeData';
    const SETTINGS_KEY = 'statusProbeSettings';
    const MANUAL_CD = 15 * 60 * 1000;       // 手动刷新CD：15分钟
    const SENSE_CD = 15 * 60 * 1000;        // 感知一下CD：15分钟（独立）
    const LOC_HIST_MAX = 20;                // 位置时间线最多保留条数
    const LOC_HIST_SHOW = 5;                // modal里展示最近几条

    // 三项定义：icon / 名称 / 5档文案（索引 0=最弱，4=最强）
    const PROBE_ITEMS = [
        {
            id: 'link',
            icon: 'fa-signal',
            name: '链接强弱',
            texts: [
                '链接极弱，字卡严重失真，几乎无法传达',
                '链接较弱，字卡有更大概率为代码抽取',
                '链接一般，字卡偶尔出现断裂',
                '链接稳定，字卡基本完整传达',
                '链接极强，字卡完整清晰传达'
            ]
        },
        {
            id: 'status',
            icon: 'fa-heart-pulse',
            name: '他的状态',
            texts: [
                '状态极差，几乎无法控制字卡',
                '状态不好，梦角名字控制字卡会更难',
                '状态一般',
                '状态良好，字卡控制稳定',
                '状态极佳，字卡传达清晰'
            ]
        },
        {
            id: 'busy',
            icon: 'fa-clock',
            name: '他有空吗',
            texts: [
                '几乎没空，无法查阅消息',
                '比较忙，梦角名字可能无法及时查阅和回复',
                '一般，时忙时闲',
                '比较有空，会及时查阅',
                '非常有空，随时查阅回复'
            ]
        }
    ];

    // ── 位置感知词库（精简版：去游戏感，重陪伴）──────────
    // 陪伴类 70%：表达陪伴感，无具体方位
    // 方位类 29%：模糊方位（左/右/前/后），不是精确罗盘
    // 彩蛋 1%：惊喜
    const LOC_COMPANION = [
        '在你身边', '一直没走远', '隔着世界在你身边',
        '隐约在你身旁', '在你看不到的地方'
    ];
    const LOC_DIRECTION = [
        '在你左边', '在你右边', '在你身后',
        '在你前面', '离你两步', '抬头就能看到',
        '在你看不到的地方偷看你'
    ];
    const LOC_EGG = '在你心里';

    function _pickArr(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

    // 随机出一个位置文案
    function _pickLocation() {
        const r = Math.random();
        if (r < 0.01) return { text: LOC_EGG, type: 'egg' };              // 1% 彩蛋
        if (r < 0.71) return { text: _pickArr(LOC_COMPANION), type: 'companion' }; // 70% 陪伴
        return { text: _pickArr(LOC_DIRECTION), type: 'direction' };      // 29% 方位
    }

    // 根据当前位置文案生成"你感觉到的"描述（仿 mochi senseDesc，去游戏感）
    function _senseDesc(cur) {
        if (!cur) return '还没感觉到 TA…试着感知一下？';
        const t = cur.text;
        if (t.indexOf('看不到') >= 0 && t.indexOf('偷看') < 0) return 'TA 在你看不到的地方，但没走远';
        if (t.indexOf('隔着世界') >= 0) return 'TA 隔着世界，隐约在你身旁';
        if (t.indexOf('没走远') >= 0) return 'TA 一直没走远，就在身边';
        if (t.indexOf('隐约') >= 0) return 'TA 隐约在你身旁，感觉到了吗';
        if (t.indexOf('心里') >= 0) return 'TA 在你心里，最近的距离';
        if (t.indexOf('身后') >= 0) return '你感觉到 TA 在你身后，很近';
        if (t.indexOf('左边') >= 0) return '你感觉到 TA 在你左边';
        if (t.indexOf('右边') >= 0) return '你感觉到 TA 在你右边';
        if (t.indexOf('前面') >= 0 || t.indexOf('抬头') >= 0) return '你感觉到 TA 就在你前面';
        if (t.indexOf('身边') >= 0) return 'TA 就在你身边，很安心';
        if (t.indexOf('两步') >= 0) return 'TA 离你两步远，一伸手就能碰到';
        if (t.indexOf('偷看') >= 0) return 'TA 在你看不到的地方偷偷看你';
        return '你感觉到 TA 在附近：' + t;
    }

    let _cdTimer = null;    // CD倒计时定时器（只在modal打开时跑）
    let _bubbleTimer = null; // 气泡自动消失定时器

    // ── 数据读写 ──────────────────────────────────────────
    function _load() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const d = JSON.parse(raw);
                PROBE_ITEMS.forEach(function (item) {
                    if (!d[item.id]) {
                        d[item.id] = { value: 3, lastRefresh: 0, lastDate: '', nextInterval: 0 };
                    }
                });
                // v3 新增字段兜底
                if (!d.locationHistory) d.locationHistory = [];
                if (!d.currentLocation) d.currentLocation = null;
                if (!d._lastSenseTime) d._lastSenseTime = 0;
                if (!d._lastManualRefresh) d._lastManualRefresh = 0;
                return d;
            }
        } catch (e) {}
        return {
            link:   { value: 3, lastRefresh: 0, lastDate: '', nextInterval: 0 },
            status: { value: 3, lastRefresh: 0, lastDate: '', nextInterval: 0 },
            busy:   { value: 3, lastRefresh: 0, lastDate: '', nextInterval: 0 },
            _lastManualRefresh: 0,
            _lastSenseTime: 0,
            currentLocation: null,
            locationHistory: []
        };
    }

    function _save(data) {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (e) {}
    }

    function _loadSettings() {
        try {
            const raw = localStorage.getItem(SETTINGS_KEY);
            if (raw) return JSON.parse(raw);
        } catch (e) {}
        return { refreshMin: 60, refreshMax: 1440 };
    }

    function _saveSettings(s) {
        try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) {}
    }

    // ── 工具函数 ──────────────────────────────────────────
    function _todayStr() {
        const d = new Date();
        return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
    }

    function _fmtMin(m) {
        if (m < 60) return m + 'min';
        const h = m / 60;
        return (h % 1 === 0) ? (h + 'h') : (h.toFixed(1) + 'h');
    }

    function _fmtTime(ts) {
        if (!ts) return '';
        const d = new Date(ts);
        const p = function (n) { return (n < 10 ? '0' + n : '' + n); };
        return p(d.getHours()) + ':' + p(d.getMinutes());
    }

    function _getPartnerName() {
        try {
            if (typeof settings !== 'undefined' && settings.partnerName) return settings.partnerName;
        } catch (e) {}
        return '梦角';
    }

    function _randomInterval(minMin, maxMin) {
        const minMs = minMin * 60 * 1000;
        const maxMs = maxMin * 60 * 1000;
        return minMs + Math.random() * (maxMs - minMs);
    }

    // ── 自动刷新逻辑（懒触发，无后台定时器）──────────────
    function _checkAndRefresh() {
        const data = _load();
        const s = _loadSettings();
        const now = Date.now();
        const today = _todayStr();
        let changed = false;

        PROBE_ITEMS.forEach(function (item) {
            const entry = data[item.id];
            const isFirstToday = entry.lastDate !== today;
            const interval = entry.nextInterval > 0
                ? entry.nextInterval
                : _randomInterval(s.refreshMin, s.refreshMax);
            const isDue = (now - entry.lastRefresh) >= interval;

            if (isFirstToday || isDue) {
                entry.value = Math.floor(Math.random() * 5) + 1;
                entry.lastRefresh = now;
                entry.lastDate = today;
                entry.nextInterval = _randomInterval(s.refreshMin, s.refreshMax);
                changed = true;
            }
        });

        if (changed) _save(data);
        return data;
    }

    // ── 手动刷新（三项一起刷，15分钟CD）──────────────────
    function _manualRefresh() {
        const data = _load();
        const now = Date.now();

        const lastManual = data._lastManualRefresh || 0;
        if (now - lastManual < MANUAL_CD) return;

        const today = _todayStr();
        const s = _loadSettings();

        PROBE_ITEMS.forEach(function (item) {
            data[item.id].value = Math.floor(Math.random() * 5) + 1;
            data[item.id].lastRefresh = now;
            data[item.id].lastDate = today;
            data[item.id].nextInterval = _randomInterval(s.refreshMin, s.refreshMax);
        });
        data._lastManualRefresh = now;
        _save(data);
        _render();
        _updateManualBtn();
    }

    // ── 感知一下（独立15分钟CD）──────────────────────────
    function _senseLocation() {
        const data = _load();
        const now = Date.now();

        const lastSense = data._lastSenseTime || 0;
        if (now - lastSense < SENSE_CD) return;  // 还在CD中

        const picked = _pickLocation();
        const cur = { text: picked.text, type: picked.type, ts: now };

        // 更新当前位置 + 写入时间线（最前面，限制条数）
        data.currentLocation = cur;
        data.locationHistory.unshift({ text: picked.text, type: picked.type, ts: now });
        if (data.locationHistory.length > LOC_HIST_MAX) {
            data.locationHistory = data.locationHistory.slice(0, LOC_HIST_MAX);
        }
        data._lastSenseTime = now;
        _save(data);

        // 渲染位置区域 + 弹气泡
        _renderLocation();
        _showLocBubble(picked.text);
        _updateSenseBtn();
    }

    // ── 顶部气泡弹窗（仿 mochi loc-change-bubble）─────────
    function _showLocBubble(text) {
        const partnerName = _getPartnerName();
        let bub = document.getElementById('sp-loc-bubble');
        if (!bub) {
            bub = document.createElement('div');
            bub.id = 'sp-loc-bubble';
            bub.className = 'sp-loc-bubble';
            document.body.appendChild(bub);
        }
        // 文案：根据是否彩蛋微调
        let msg;
        if (text === LOC_EGG) {
            msg = partnerName + '就在你心里，最近的距离';
        } else {
            msg = '你感觉到 ' + partnerName + ' 现在' + text;
        }
        bub.textContent = msg;
        bub.classList.add('sp-loc-bubble-show');
        clearTimeout(_bubbleTimer);
        _bubbleTimer = setTimeout(function () {
            bub.classList.remove('sp-loc-bubble-show');
        }, 3000);
    }

    // ── 渲染 ──────────────────────────────────────────────
    function _render() {
        _renderSignals();
        _renderLocation();
        _updateManualBtn();
        _updateSenseBtn();
    }

    function _renderSignals() {
        const data = _load();
        const partnerName = _getPartnerName();
        const listEl = document.getElementById('sp-list');
        if (!listEl) return;

        const html = PROBE_ITEMS.map(function (item) {
            const entry = data[item.id];
            const value = entry.value;
            const text = item.texts[value - 1].replace(/梦角名字/g, partnerName);

            let barsHTML = '';
            for (let i = 1; i <= 5; i++) {
                barsHTML += '<div class="sp-bar' + (i <= value ? ' active' : '') + '"></div>';
            }

            return '' +
                '<div class="sp-item">' +
                    '<div class="sp-item-header">' +
                        '<div class="sp-item-title"><i class="fas ' + item.icon + '"></i>' + item.name + '</div>' +
                        '<div class="sp-signal">' + barsHTML + '</div>' +
                    '</div>' +
                    '<div class="sp-text">' + text + '</div>' +
                '</div>';
        }).join('');

        listEl.innerHTML = html;

        const noteEl = document.getElementById('sp-note');
        if (noteEl) {
            noteEl.textContent = '用于参考判断"是否连上"，请以你的实际体感为准；链接弱时对' + partnerName + '状态和忙碌程度探测可能不准确';
        }
    }

    function _renderLocation() {
        const data = _load();
        const wrap = document.getElementById('sp-loc');
        if (!wrap) return;

        const cur = data.currentLocation;
        const hist = data.locationHistory || [];
        const senseText = _senseDesc(cur);

        // 当前位置 + 感知按钮
        let html = '';
        html += '<div class="sp-loc-head">';
        html += '   <div class="sp-loc-dot"></div>';
        html += '   <span class="sp-loc-title">位置感知</span>';
        html += '</div>';
        html += '<div class="sp-loc-sense">' + _esc(senseText) + '</div>';

        // 当前位置展示
        if (cur) {
            html += '<div class="sp-loc-cur">';
            html += '   <span class="sp-loc-cur-text">' + _esc(cur.text) + '</span>';
            html += '   <span class="sp-loc-cur-time">' + _fmtTime(cur.ts) + '</span>';
            html += '</div>';
        }

        // 时间线（最近5条）
        if (hist.length) {
            html += '<div class="sp-loc-timeline">';
            hist.slice(0, LOC_HIST_SHOW).forEach(function (h) {
                html += '<div class="sp-loc-tl-item">';
                html += '   <span class="sp-loc-tl-time">' + _fmtTime(h.ts) + '</span>';
                html += '   <span class="sp-loc-tl-text">' + _esc(h.text) + '</span>';
                html += '</div>';
            });
            html += '</div>';
            if (hist.length > LOC_HIST_SHOW) {
                html += '<div class="sp-loc-more">共 ' + hist.length + ' 条记录</div>';
            }
        }

        // 感知按钮
        html += '<button class="sp-sense-btn" id="sp-sense-btn">';
        html += '<i class="fas fa-compass"></i> 感知一下';
        html += '</button>';

        wrap.innerHTML = html;

        // 绑定感知按钮
        const btn = document.getElementById('sp-sense-btn');
        if (btn) btn.addEventListener('click', _senseLocation);
    }

    function _esc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // ── 按钮CD状态更新 ────────────────────────────────────
    function _updateManualBtn() {
        const btn = document.getElementById('sp-manual-refresh-btn');
        if (!btn) return;
        const data = _load();
        const now = Date.now();
        const lastManual = data._lastManualRefresh || 0;
        const remaining = MANUAL_CD - (now - lastManual);

        if (remaining > 0) {
            const mins = Math.floor(remaining / 60000);
            const secs = Math.floor((remaining % 60000) / 1000);
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-hourglass-half"></i> ' + mins + '分' + secs + '秒后可重新探测';
        } else {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-rotate"></i> 重新探测';
        }
    }

    function _updateSenseBtn() {
        const btn = document.getElementById('sp-sense-btn');
        if (!btn) return;
        const data = _load();
        const now = Date.now();
        const lastSense = data._lastSenseTime || 0;
        const remaining = SENSE_CD - (now - lastSense);

        if (remaining > 0) {
            const mins = Math.floor(remaining / 60000);
            const secs = Math.floor((remaining % 60000) / 1000);
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-hourglass-half"></i> ' + mins + '分' + secs + '秒后可感知';
        } else {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-compass"></i> 感知一下';
        }
    }

    // CD倒计时定时器（只在modal打开时跑，关闭就清除）
    function _startCDTimer() {
        if (_cdTimer) clearInterval(_cdTimer);
        _cdTimer = setInterval(function () {
            _updateManualBtn();
            _updateSenseBtn();
            const modal = document.getElementById('status-probe-modal');
            if (!modal || modal.style.display === 'none' || modal.style.display === '') {
                clearInterval(_cdTimer);
                _cdTimer = null;
            }
        }, 1000);
    }

    // ── 打开 modal ────────────────────────────────────────
    function _open() {
        _checkAndRefresh();
        _render();
        const modal = document.getElementById('status-probe-modal');
        if (modal && typeof showModal === 'function') {
            showModal(modal);
        }
        _startCDTimer();
    }

    // ── 设置 slider 绑定 ─────────────────────────────────
    function _bindSettingsSliders() {
        const minSlider = document.getElementById('sp-refresh-min-slider');
        const maxSlider = document.getElementById('sp-refresh-max-slider');
        if (!minSlider || !maxSlider) return;

        const s = _loadSettings();
        const minVal = document.getElementById('sp-refresh-min-value');
        const maxVal = document.getElementById('sp-refresh-max-value');

        minSlider.value = s.refreshMin;
        maxSlider.value = s.refreshMax;
        if (minVal) minVal.textContent = _fmtMin(s.refreshMin);
        if (maxVal) maxVal.textContent = _fmtMin(s.refreshMax);
        maxSlider.min = minSlider.value;

        minSlider.addEventListener('input', function () {
            if (minVal) minVal.textContent = _fmtMin(+minSlider.value);
            if (+minSlider.value > +maxSlider.value) {
                maxSlider.value = minSlider.value;
                if (maxVal) maxVal.textContent = _fmtMin(+maxSlider.value);
            }
            maxSlider.min = minSlider.value;
        });
        minSlider.addEventListener('change', function () {
            const cur = _loadSettings();
            cur.refreshMin = +minSlider.value;
            if (cur.refreshMin > cur.refreshMax) cur.refreshMax = cur.refreshMin;
            _saveSettings(cur);
            _syncSettingsUI();
        });
        maxSlider.addEventListener('input', function () {
            if (maxVal) maxVal.textContent = _fmtMin(+maxSlider.value);
        });
        maxSlider.addEventListener('change', function () {
            const cur = _loadSettings();
            cur.refreshMax = +maxSlider.value;
            _saveSettings(cur);
        });
    }

    function _syncSettingsUI() {
        const s = _loadSettings();
        const minSlider = document.getElementById('sp-refresh-min-slider');
        const maxSlider = document.getElementById('sp-refresh-max-slider');
        const minVal = document.getElementById('sp-refresh-min-value');
        const maxVal = document.getElementById('sp-refresh-max-value');
        if (minSlider) minSlider.value = s.refreshMin;
        if (maxSlider) maxSlider.value = s.refreshMax;
        if (minVal) minVal.textContent = _fmtMin(s.refreshMin);
        if (maxVal) maxVal.textContent = _fmtMin(s.refreshMax);
        if (minSlider && maxSlider) maxSlider.min = minSlider.value;
    }

    // ── 入口绑定 ──────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', function () {
        _checkAndRefresh();

        const entry = document.getElementById('status-probe-function');
        if (entry) entry.addEventListener('click', _open);

        _bindSettingsSliders();

        const manualBtn = document.getElementById('sp-manual-refresh-btn');
        if (manualBtn) manualBtn.addEventListener('click', _manualRefresh);

        // 把更多菜单里的"位置"占位项升级为真实功能：
        // 点"位置"图标 → 打开状态探测 modal + 自动触发感知一下
        // （CD 中时 _senseLocation 内部会自动跳过，只打开 modal 让用户看倒计时）
        if (window.MoreMenu && window.MoreMenu.registerItem) {
            window.MoreMenu.registerItem('location', {
                ready: true,
                action: function () {
                    _open();
                    setTimeout(_senseLocation, 400);
                }
            });
        }
    });

    // 暴露接口
    window._statusProbe = {
        open: _open,
        refresh: _manualRefresh,
        checkAndRefresh: _checkAndRefresh,
        senseLocation: _senseLocation
    };
})();
