/* ============================================================
   花园简化版 (garden) v1
   - 6地块 / 6种花 / 4生长阶段（种子→发芽→成长→开花）
   - 种植 / 浇水（加速）/ 收获
   - TA代管：打开时TA有概率来浇水（"一起养"核心）
   - 生长基于时间戳自动推进
   - 入口：高级功能面板
   - 数据存 localStorage，backup-engine 全量收集不影响导入导出
   ============================================================ */

(function () {
    const STORAGE_KEY = 'gardenData';
    const PLOT_COUNT = 6;
    const TA_CHECK_INTERVAL = 30 * 60 * 1000;  // TA代管检查间隔：30分钟
    const TA_WATER_PROB = 0.4;                  // TA浇水概率：40%

    // 花种定义：4阶段emoji + 各阶段生长秒数
    // 阶段0=种子(🌱) 1=发芽(🌿) 2=成长(🪴) 3=开花(花种专属emoji)
    const FLOWERS = [
        { id: 'rose',      name: '玫瑰',     emoji: '🌹', stages: ['🌱', '🌿', '🪴', '🌹'], growSec: [300, 600, 900] },
        { id: 'sunflower', name: '向日葵',   emoji: '🌻', stages: ['🌱', '🌿', '🪴', '🌻'], growSec: [300, 600, 900] },
        { id: 'daisy',     name: '雏菊',     emoji: '🌼', stages: ['🌱', '🌿', '🪴', '🌼'], growSec: [300, 600, 900] },
        { id: 'tulip',     name: '郁金香',   emoji: '🌷', stages: ['🌱', '🌿', '🪴', '🌷'], growSec: [300, 600, 900] },
        { id: 'lavender',  name: '薰衣草',   emoji: '💜', stages: ['🌱', '🌿', '🪴', '💜'], growSec: [300, 600, 900] },
        { id: 'sakura',    name: '樱花',     emoji: '🌸', stages: ['🌱', '🌿', '🪴', '🌸'], growSec: [300, 600, 900] }
    ];

    const STAGE_NAMES = ['种子', '发芽', '成长中', '已开花'];

    function _findFlower(id) {
        return FLOWERS.find(function (f) { return f.id === id; });
    }

    function _getPartnerName() {
        try {
            if (typeof settings !== 'undefined' && settings.partnerName) return settings.partnerName;
        } catch (e) {}
        return '梦角';
    }

    // ── 数据读写 ──────────────────────────────────────────
    function _load() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const d = JSON.parse(raw);
                if (!d.plots) d.plots = new Array(PLOT_COUNT).fill(null);
                while (d.plots.length < PLOT_COUNT) d.plots.push(null);
                if (!d.stats) d.stats = { planted: 0, watered: 0, harvested: 0, taWatered: 0 };
                // 收获花库存（按花种计数）：给未来礼物系统预留
                if (!d.stats.byFlower) d.stats.byFlower = {};
                if (!d.lastTaCheck) d.lastTaCheck = 0;
                if (!d.log) d.log = [];
                return d;
            }
        } catch (e) {}
        return {
            plots: new Array(PLOT_COUNT).fill(null),
            stats: { planted: 0, watered: 0, harvested: 0, taWatered: 0, byFlower: {} },
            lastTaCheck: 0,
            log: []
        };
    }

    function _save(data) {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (e) {}
    }

    function _addLog(data, who, act) {
        data.log.unshift({ who: who, act: act, tm: Date.now() });
        if (data.log.length > 10) data.log = data.log.slice(0, 10);
    }

    // ── 生长阶段计算 ──────────────────────────────────────
    // 返回当前阶段(0-3) + 下一阶段剩余秒数（开花后返回 0）
    function _stageInfo(plot) {
        if (!plot) return null;
        const flower = _findFlower(plot.type);
        if (!flower) return null;
        const elapsed = (Date.now() - plot.planted) / 1000;
        let stage = 0;
        let cumulative = 0;
        for (let i = 0; i < flower.growSec.length; i++) {
            cumulative += flower.growSec[i] * (plot.waterBoost || 1);
            if (elapsed >= cumulative) {
                stage = i + 1;
            } else {
                break;
            }
        }
        if (stage >= 3) return { stage: 3, remaining: 0, flower: flower };
        // 计算下一阶段剩余
        const nextThreshold = flower.growSec[stage] * (plot.waterBoost || 1);
        const stageElapsed = elapsed - (stage > 0 ? flower.growSec.slice(0, stage).reduce(function (a, b) { return a + b; }, 0) * (plot.waterBoost || 1) : 0);
        const remaining = Math.max(0, Math.ceil(nextThreshold - stageElapsed));
        return { stage: stage, remaining: remaining, flower: flower };
    }

    // ── TA代管：打开时检查，每30分钟槽40%概率浇水 ────────
    function _checkTaAction(data) {
        const now = Date.now();
        const elapsed = now - (data.lastTaCheck || 0);
        if (elapsed < TA_CHECK_INTERVAL) return null;

        const slots = Math.floor(elapsed / TA_CHECK_INTERVAL);
        let taWatered = false;

        for (let s = 0; s < slots; s++) {
            if (Math.random() < TA_WATER_PROB) {
                // TA浇一个有花且未开花的地块
                const candidates = [];
                data.plots.forEach(function (p, idx) {
                    if (p) {
                        const info = _stageInfo(p);
                        if (info && info.stage < 3) candidates.push(idx);
                    }
                });
                if (candidates.length) {
                    const pick = candidates[Math.floor(Math.random() * candidates.length)];
                    const p = data.plots[pick];
                    if (!p.waterBoost || p.waterBoost === 1) {
                        p.waterBoost = 0.5;  // 浇水后生长时间减半
                        p.wateredAt = now - s * TA_CHECK_INTERVAL;
                        data.stats.taWatered++;
                        taWatered = true;
                        _addLog(data, _getPartnerName(), '浇了水');
                    }
                }
            }
        }
        data.lastTaCheck = now;
        return taWatered;
    }

    // ── 种植 ──────────────────────────────────────────────
    function _plant(idx, flowerId) {
        const data = _load();
        if (data.plots[idx]) return;  // 地块已有花
        const flower = _findFlower(flowerId);
        if (!flower) return;

        data.plots[idx] = {
            type: flowerId,
            planted: Date.now(),
            waterBoost: 1,
            wateredAt: 0
        };
        data.stats.planted++;
        _addLog(data, '我', '种了' + flower.name);
        _save(data);
        _render();
    }

    // ── 浇水（加速生长：剩余时间减半）────────────────────
    function _water(idx) {
        const data = _load();
        const plot = data.plots[idx];
        if (!plot) return;
        const info = _stageInfo(plot);
        if (!info || info.stage >= 3) return;  // 开花了不用浇

        // 浇水 = waterBoost 设为 0.5（生长时间减半）
        // 已浇过就不再叠加（简化）
        if (plot.waterBoost === 0.5) return;

        plot.waterBoost = 0.5;
        plot.wateredAt = Date.now();
        data.stats.watered++;
        _addLog(data, '我', '浇了水');
        _save(data);
        _render();
    }

    // ── 收获 ──────────────────────────────────────────────
    function _harvest(idx) {
        const data = _load();
        const plot = data.plots[idx];
        if (!plot) return;
        const info = _stageInfo(plot);
        if (!info || info.stage < 3) return;  // 没开花不能收

        const flower = info.flower;
        data.plots[idx] = null;
        data.stats.harvested++;
        // 按花种记入库存（未来礼物系统用）
        if (!data.stats.byFlower[flower.id]) data.stats.byFlower[flower.id] = 0;
        data.stats.byFlower[flower.id]++;
        _addLog(data, '我', '收获了' + flower.name);
        _save(data);
        _render();
    }

    // ── 渲染 ──────────────────────────────────────────────
    function _esc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function _fmtRemaining(sec) {
        if (sec <= 0) return '';
        if (sec < 60) return sec + '秒';
        if (sec < 3600) return Math.ceil(sec / 60) + '分钟';
        return (sec / 3600).toFixed(1) + '小时';
    }

    function _render() {
        const data = _load();
        const partnerName = _getPartnerName();
        const grid = document.getElementById('gd-grid');
        if (!grid) return;

        let html = '';
        data.plots.forEach(function (plot, idx) {
            if (!plot) {
                // 空地块
                html += '<div class="gd-plot gd-plot-empty" data-idx="' + idx + '">';
                html += '<div class="gd-plot-emoji">🟫</div>';
                html += '<div class="gd-plot-label">空地</div>';
                html += '<button class="gd-plant-btn" data-idx="' + idx + '">种植</button>';
                html += '</div>';
            } else {
                const info = _stageInfo(plot);
                const flower = info.flower;
                const isBloomed = info.stage >= 3;
                const isWatered = plot.waterBoost === 0.5;

                html += '<div class="gd-plot' + (isBloomed ? ' gd-plot-bloomed' : '') + '" data-idx="' + idx + '">';
                html += '<div class="gd-plot-emoji' + (isBloomed ? ' gd-sway' : '') + '">' + flower.stages[info.stage] + '</div>';
                html += '<div class="gd-plot-name">' + _esc(flower.name) + '</div>';
                html += '<div class="gd-plot-stage">' + STAGE_NAMES[info.stage];
                if (!isBloomed && info.remaining > 0) {
                    html += '<span class="gd-plot-remain">·' + _fmtRemaining(info.remaining) + '</span>';
                }
                html += '</div>';
                if (isWatered && !isBloomed) {
                    html += '<div class="gd-plot-watered">💧 已浇水</div>';
                }
                // 操作按钮
                if (isBloomed) {
                    html += '<button class="gd-act-btn gd-harvest-btn" data-idx="' + idx + '">收获</button>';
                } else {
                    html += '<button class="gd-act-btn gd-water-btn' + (isWatered ? ' gd-disabled' : '') + '" data-idx="' + idx + '"' + (isWatered ? ' disabled' : '') + '>浇水</button>';
                }
                html += '</div>';
            }
        });
        grid.innerHTML = html;

        // 绑定按钮
        grid.querySelectorAll('.gd-plant-btn').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                _showPlantPicker(+btn.dataset.idx);
            });
        });
        grid.querySelectorAll('.gd-water-btn').forEach(function (btn) {
            if (!btn.disabled) {
                btn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    _water(+btn.dataset.idx);
                });
            }
        });
        grid.querySelectorAll('.gd-harvest-btn').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                _harvest(+btn.dataset.idx);
            });
        });

        // 统计
        const statsEl = document.getElementById('gd-stats');
        if (statsEl) {
            const s = data.stats;
            statsEl.innerHTML = '<span>🌱 种 ' + s.planted + '</span><span>💧 浇 ' + (s.watered + s.taWatered) + '</span><span>✨ 收 ' + s.harvested + '</span>';
        }

        // 日志
        const logEl = document.getElementById('gd-log');
        if (logEl) {
            if (data.log.length) {
                logEl.innerHTML = data.log.slice(0, 5).map(function (l) {
                    const t = new Date(l.tm);
                    const p = function (n) { return (n < 10 ? '0' + n : '' + n); };
                    return '<div class="gd-log-item"><span class="gd-log-time">' + p(t.getHours()) + ':' + p(t.getMinutes()) + '</span><span class="gd-log-text">' + _esc(l.who) + ' ' + _esc(l.act) + '</span></div>';
                }).join('');
            } else {
                logEl.innerHTML = '<div class="gd-log-empty">还没有花园日志</div>';
            }
        }

        // 说明文字（动态填入梦角名字）
        const noteEl = document.getElementById('gd-note');
        if (noteEl) {
            noteEl.textContent = '和' + partnerName + '一起养花。种下后等它慢慢长大，浇水能让生长速度加快。打开花园时' + partnerName + '可能会来帮你浇水。';
        }
    }

    // ── 种植选择器（弹出花种列表）────────────────────────
    function _showPlantPicker(idx) {
        const picker = document.getElementById('gd-picker');
        if (!picker) return;

        let html = '<div class="gd-picker-title">选一种花</div><div class="gd-picker-grid">';
        FLOWERS.forEach(function (f) {
            html += '<div class="gd-picker-item" data-flower="' + f.id + '">';
            html += '<div class="gd-picker-emoji">' + f.emoji + '</div>';
            html += '<div class="gd-picker-name">' + _esc(f.name) + '</div>';
            html += '</div>';
        });
        html += '</div><button class="gd-picker-cancel">取消</button>';
        picker.innerHTML = html;
        picker.style.display = 'flex';

        picker.querySelectorAll('.gd-picker-item').forEach(function (item) {
            item.addEventListener('click', function () {
                _plant(idx, item.dataset.flower);
                picker.style.display = 'none';
            });
        });
        picker.querySelector('.gd-picker-cancel').addEventListener('click', function () {
            picker.style.display = 'none';
        });
    }

    // ── 打开 modal ────────────────────────────────────────
    function _open() {
        const data = _load();
        // TA代管检查
        const taWatered = _checkTaAction(data);
        if (taWatered) {
            _showTaBubble();
        }
        _save(data);
        _render();
        const modal = document.getElementById('garden-modal');
        if (modal && typeof showModal === 'function') {
            showModal(modal);
        }
        // 每30秒刷新一次（更新剩余时间）
        if (_refreshTimer) clearInterval(_refreshTimer);
        _refreshTimer = setInterval(function () {
            const modal = document.getElementById('garden-modal');
            if (!modal || modal.style.display === 'none' || modal.style.display === '') {
                clearInterval(_refreshTimer);
                _refreshTimer = null;
                return;
            }
            _render();
        }, 30000);
    }

    let _refreshTimer = null;

    // TA浇水后的小气泡提示
    function _showTaBubble() {
        const partnerName = _getPartnerName();
        let bub = document.getElementById('gd-ta-bubble');
        if (!bub) {
            bub = document.createElement('div');
            bub.id = 'gd-ta-bubble';
            bub.className = 'gd-ta-bubble';
            document.body.appendChild(bub);
        }
        bub.textContent = partnerName + '刚刚来浇过水 💧';
        bub.classList.add('gd-ta-bubble-show');
        clearTimeout(bub._t);
        bub._t = setTimeout(function () {
            bub.classList.remove('gd-ta-bubble-show');
        }, 3000);
    }

    // ── 入口绑定 ──────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', function () {
        const entry = document.getElementById('garden-function');
        if (entry) entry.addEventListener('click', _open);

        // 更多菜单注册"花园"（如果 more-menu 里有占位项的话——没有就不注册）
        // 目前 more-menu 没有 garden 占位项，入口走高级功能面板
    });

    // 暴露接口
    window._garden = {
        open: _open,
        plant: _plant,
        water: _water,
        harvest: _harvest
    };
})();
