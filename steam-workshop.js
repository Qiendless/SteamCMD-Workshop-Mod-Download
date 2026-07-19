// ==UserScript==
// @name         Steam 创意工坊Mod下载工具 - 模组ID批量提取与导出
// @name:zh-CN   Steam 创意工坊Mod下载工具 - 模组ID批量提取与导出
// @name:en      Steam Workshop Mod Tool - Batch Extract & Export IDs
// @namespace    http://tampermonkey.net/
// @version      3.0
// @description  悬浮海报按钮(复制ID/SteamCMD/收藏到收藏夹)；收藏面板(批量收藏)；列表管理器(搜索/排序/批量导出)；全工坊页面自动识别
// @description:en Hover poster buttons (Copy ID/SteamCMD/Subscribe); Workshop item page panel (batch collect); List manager (search/sort/batch export); Auto-detect all workshop pages
// @author       godsq
// @match        https://steamcommunity.com/workshop/*
// @match        https://steamcommunity.com/app/*/workshop*
// @match        https://steamcommunity.com/sharedfiles/filedetails/?id=*
// @match        https://steamcommunity.com/profiles/*/myworkshopfiles*
// @match        https://steamcommunity.com/id/*/myworkshopfiles*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=steamcommunity.com
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_addStyle
// @license      MIT
// ==/UserScript==
(function() {
    'use strict';
    /* 分区 1 · 配置与常量：集中管理脚本运行所需的常量、存储键名与默认参数 */
    const CFG = {
        STORAGE_TIMESTAMPS: 'ws3_timestamps',
        STORAGE_COLLECTING: 'ws3_collecting',
        STORAGE_PAGE: 'ws3_page',
        STORAGE_TOTAL_PAGES: 'ws3_total_pages',
        STORAGE_TOTAL_ITEMS: 'ws3_total_items',
        STORAGE_LAST_PAGE: 'ws3_last_page',
        TARGET_PER_PAGE: 30,
        DRAG_THRESHOLD: 5,
        DEBOUNCE_SAVE: 300,
        DEBOUNCE_SEARCH: 200,
        OBSERVER_TIMEOUT: 8000,
        _appId: '0',
        setApp(id) { this._appId = id; },
        _key(base) { return base + '_' + this._appId; }
    };
    /* 分区 2 · 工具函数：防抖、剪贴板复制、URL 解析、HTML 转义与统一复制提示 */
    const Utils = {
        debounce(fn, delay) {
            let timer = null;
            return function (...args) {
                clearTimeout(timer);
                timer = setTimeout(() => fn.apply(this, args), delay);
            };
        },
        escapeHtml(str) {
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        },
        formatTime(ts) {
            const d = new Date(ts);
            const pad = n => String(n).padStart(2, '0');
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        },
        normalizeDate(dateText) {
            if (!dateText) return '';
            const s = String(dateText).trim();
            const pad = n => String(n).padStart(2, '0');
            const h24 = (h, isPm, isAm) => {
                let v = parseInt(h, 10);
                if (isPm && v < 12) v += 12;
                if (isAm && v === 12) v = 0;
                return pad(v);
            };
            if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}$/.test(s)) return s;
            const cleaned = s.replace(/\s+/g, '');
            const hasPm = /下午|PM/i.test(s);
            const hasAm = /上午|AM/i.test(s);
            const mFull = cleaned.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日(?:上午|下午|AM|PM)?(\d{1,2}):(\d{2})$/i);
            if (mFull) {
                return `${mFull[1]}-${pad(mFull[2])}-${pad(mFull[3])} ${h24(mFull[4], hasPm, hasAm)}:${mFull[5]}`;
            }
            const mDateOnlyYear = cleaned.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/);
            if (mDateOnlyYear) {
                return `${mDateOnlyYear[1]}-${pad(mDateOnlyYear[2])}-${pad(mDateOnlyYear[3])} 00:00`;
            }
            const mNoYear = cleaned.match(/^(\d{1,2})月(\d{1,2})日(?:上午|下午|AM|PM)?(\d{1,2}):(\d{2})$/i);
            if (mNoYear) {
                const now = new Date();
                const month = parseInt(mNoYear[1], 10);
                const day = parseInt(mNoYear[2], 10);
                let year = now.getFullYear();
                if (month > now.getMonth() + 1 || (month === now.getMonth() + 1 && day > now.getDate())) year -= 1;
                return `${year}-${pad(month)}-${pad(day)} ${h24(mNoYear[3], hasPm, hasAm)}:${mNoYear[4]}`;
            }
            const mDayOnly = cleaned.match(/^(\d{1,2})月(\d{1,2})日$/);
            if (mDayOnly) {
                const now = new Date();
                const month = parseInt(mDayOnly[1], 10);
                const day = parseInt(mDayOnly[2], 10);
                let year = now.getFullYear();
                if (month > now.getMonth() + 1 || (month === now.getMonth() + 1 && day > now.getDate())) year -= 1;
                return `${year}-${pad(month)}-${pad(day)} 00:00`;
            }
            const mIso = cleaned.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
            if (mIso) {
                const rest = cleaned.slice(mIso[0].length);
                const t = rest.match(/(\d{1,2}):(\d{2})/) || ['', '0', '0'];
                const hasRestPm = /PM|下午/i.test(rest);
                const hasRestAm = /AM|上午/i.test(rest);
                return `${mIso[1]}-${pad(mIso[2])}-${pad(mIso[3])} ${h24(t[1], hasRestPm, hasRestAm)}:${pad(parseInt(t[2], 10))}`;
            }
            return s;
        },
        parseDateToTs(dateText) {
            const normalized = this.normalizeDate(dateText);
            if (!normalized) return 0;
            const ts = new Date(normalized.replace(' ', 'T')).getTime();
            return isNaN(ts) ? 0 : ts;
        },
        copyToClipboard(text) {
            return navigator.clipboard.writeText(text);
        },
        copyWithToast(text, successMsg) {
            return Utils.copyToClipboard(text)
                .then(() => Toast.success(successMsg))
                .catch(() => Toast.error('复制失败'));
        },
        copyPageEntries(extractFn, { asCmd = false, emptyMsg = '未检测到模组' } = {}) {
            const raw = extractFn();
            const entries = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
            const ids = Object.keys(entries);
            if (ids.length === 0) {
                Toast.warning(emptyMsg);
                return;
            }
            const text = asCmd ? PageDetector.getSteamCmdText(ids) : ids.join('\n');
            Utils.copyWithToast(text, `已复制 ${ids.length} ${asCmd ? '条 CMD' : '个 ID'}`);
        }
    };
    /* 分区 3 · 图标资源：内联 SVG 图标，供界面按钮统一复用 */

    const SVG_OPEN='viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">';
    const SEL={FILE_DETAILS_LINK:'a[href*="/sharedfiles/filedetails/?id="]',ITEM_CHECKBOX:'.ws3-item-checkbox',WORKSHOP_ITEM_TITLE:'.workshopItemTitle',GAME_SELECT:'[data-game-select]',DIGIT:'.ws3-digit',LIST_BTN:'#ws3-list-btn',ROW_BY_ID:'tr[data-id]',DATA_ACTION:'[data-action]',WORKSHOP_ITEM:'.workshopItem, .workshopItemSubscription',WORKSHOP_ITEM_APP:'.workshopItemApp',WORKSHOP_ITEM_PREVIEW:'.workshopItemPreviewImage'};
    const CLS={ADDED:'ws3-added',BTN_SECONDARY:'ws3-btn-secondary',BTN_ACCENT:'ws3-btn-accent'};
    const KEYS={ITEMS:'ws3_items',COLLECTIONS:'ws3_collections',POSTERS:'ws3_posters',ITEM_DATES:'ws3_item_dates',ITEM_DESCS:'ws3_item_descs',LAST_CHECK:'ws3_last_check',GAME_NAMES:'ws3_game_names',COLLECTION_DATES:'ws3_collection_dates',COLLECTION_TIMESTAMPS:'ws3_collection_timestamps',COLLECTION_POSTERS:'ws3_collection_posters',ITEMS_PREFIX:'ws3_items_',COLLECTIONS_PREFIX:'ws3_collections_',PREVIEW_ENABLED:'ws3_preview_enabled',TIMESTAMPS_PREFIX:'ws3_timestamps_',ITEM_DATES_PREFIX:'ws3_item_dates_',POSTERS_PREFIX:'ws3_posters_',COLLECTION_DATES_PREFIX:'ws3_collection_dates_',COLLECTION_TIMESTAMPS_PREFIX:'ws3_collection_timestamps_',COLLECTION_POSTERS_PREFIX:'ws3_collection_posters_'};
    const ICONS = {
        copy: `<svg ${SVG_OPEN}
            <path d="M19 2h-4.18C14.4.84 13.3 0 12 0c-1.3 0-2.4.84-2.82 2H5C3.9 2 3 2.9 3 4v16c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm2 4H10v2h4V6zm0 4H10v2h4v-2zm0 4H10v2h4v-2z"/>
        </svg>`,
        cmd: `<svg ${SVG_OPEN}
            <rect x="2" y="3" width="20" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/>
            <path d="M6 8l3 3-3 3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            <line x1="11" y1="13" x2="16" y2="13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>`,
        collect: `<svg fill-rule="evenodd" ${SVG_OPEN}
            <path d="M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2zm-4 11h-2v-2h-2v-2h2v-2h2v2h2v2h-2v2z"/>
        </svg>`,
        check: `<svg ${SVG_OPEN}
            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
        </svg>`
    };
    /* 分区 4 · 样式注入：向页面注入脚本所需的全部 CSS 样式 */
    GM_addStyle(`
        :root {
            --ws3-bg-primary: #1b2838;
            --ws3-bg-secondary: #16202d;
            --ws3-bg-tertiary: #212d3d;
            --ws3-bg-hover: #2a3f5f;
            --ws3-bg-overlay: rgba(0, 0, 0, 0.65);
            --ws3-border: #354f6e;
            --ws3-border-light: #4a6a8e;
            --ws3-text-primary: #e2e9f0;
            --ws3-text-secondary: #b0b9c3;
            --ws3-text-muted: #7e8894;
            --ws3-accent: #66c0f4;
            --ws3-accent-hover: #7dc9f5;
            --ws3-accent-bg: rgba(102, 192, 244, 0.12);
            --ws3-success: #27ae60;
            --ws3-success-hover: #2ecc71;
            --ws3-success-bg: rgba(39, 174, 96, 0.12);
            --ws3-danger: #e74c3c;
            --ws3-danger-hover: #ff6b6b;
            --ws3-danger-bg: rgba(231, 76, 60, 0.12);
            --ws3-warning: #f39c12;
            --ws3-warning-hover: #f5b041;
            --ws3-purple: #9b59b6;
            --ws3-purple-hover: #af7ac5;
            --ws3-radius-sm: 4px;
            --ws3-radius: 7px;
            --ws3-radius-lg: 10px;
            --ws3-radius-xl: 14px;
            --ws3-transition-fast: 0.15s cubic-bezier(0.4, 0, 0.2, 1);
            --ws3-transition: 0.25s cubic-bezier(0.4, 0, 0.2, 1);
            --ws3-transition-slow: 0.35s cubic-bezier(0.4, 0, 0.2, 1);
            --ws3-font-mono: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
            --ws3-font-ui: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        .ws3-toast-container {
            position: fixed;
            top: 16px;
            right: 16px;
            z-index: 2147483647;
            display: flex;
            flex-direction: column;
            gap: 8px;
            pointer-events: none;
        }
        .ws3-toast {
            background: var(--ws3-bg-secondary);
            border: 1px solid var(--ws3-border);
            border-left: 3px solid var(--ws3-accent);
            color: var(--ws3-text-primary);
            padding: 10px 18px;
            border-radius: var(--ws3-radius);
            font-family: var(--ws3-font-ui);
            font-size: 13px;
            box-shadow: none;
            pointer-events: auto;
            animation: ws3-toast-in 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            max-width: 380px;
            word-break: break-word;
        }
        .ws3-toast.removing {
            animation: ws3-toast-out 0.25s cubic-bezier(0.4, 0, 0.2, 1) forwards;
        }
        .ws3-toast.ws3-toast-success { border-left-color: var(--ws3-success); }
        .ws3-toast.ws3-toast-error { border-left-color: var(--ws3-danger); }
        .ws3-toast.ws3-toast-warning { border-left-color: var(--ws3-warning); }
        @keyframes ws3-toast-in {
            from { transform: translateX(120%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        @keyframes ws3-toast-out {
            from { transform: translateX(0); opacity: 1; }
            to { transform: translateX(120%); opacity: 0; }
        }
        .ws3-hover-overlay {
            position: absolute;
            bottom: 4px;
            right: 4px;
            display: none;
            flex-direction: row;
            align-items: center;
            justify-content: flex-end;
            gap: 4px;
            opacity: 0;
            visibility: hidden;
            pointer-events: none;
            transition: none;
            z-index: 10;
            transform-origin: bottom right;
        }
        .ws3-poster-container {
            position: relative;
        }
        .ws3-poster-container:hover .ws3-hover-overlay,
        .ws3-hover-overlay:hover,
        .ws3-hover-overlay:focus-within {
            display: flex;
            opacity: 1;
            visibility: visible;
            pointer-events: auto;
        }
        .ws3-hover-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            --ws3-btn-scale: 1;
            width: calc(38px * var(--ws3-btn-scale));
            height: calc(38px * var(--ws3-btn-scale));
            padding: 0;
            border: none;
            border-radius: calc(8px * var(--ws3-btn-scale));
            cursor: pointer;
            color: #fff;
            transition: none;
            white-space: nowrap;
            flex-shrink: 0;
        }
        .ws3-hover-btn svg {
            width: calc(26px * var(--ws3-btn-scale));
            height: calc(26px * var(--ws3-btn-scale));
            display: block;
        }
        .ws3-hover-btn:hover {
            filter: brightness(1.15);
        }
        .ws3-hover-btn:active {
            filter: brightness(0.9);
        }
        .ws3-hover-btn.ws3-hov-copy {
            background: linear-gradient(135deg, #4aa3f0, #2563eb);
        }
        .ws3-hover-btn.ws3-hov-cmd {
            background: linear-gradient(135deg, #fbbf24, #d97706);
        }
        .ws3-hover-btn.ws3-hov-sub {
            background: linear-gradient(135deg, #34d399, #059669);
        }
        .ws3-hover-btn.ws3-hov-collect {
            background: linear-gradient(135deg, #34d399, #059669);
            color: #fff;
            width: auto;
            min-width: calc(70px * var(--ws3-btn-scale));
            height: auto;
            min-height: calc(25px * var(--ws3-btn-scale));
            padding: calc(6px * var(--ws3-btn-scale)) calc(9px * var(--ws3-btn-scale));
            font-size: calc(10.5px * var(--ws3-btn-scale));
            font-weight: 600;
            gap: 2px;
            border-radius: calc(5px * var(--ws3-btn-scale));
            white-space: nowrap;
        }
        .ws3-hover-btn.ws3-added {
            background: var(--ws3-success) !important;
            color: #fff;
        }
        .ws3-collect-inline {
            display: inline-flex !important;
            align-items: center;
            justify-content: center;
            width: 30px;
            height: 30px;
            margin-right: 4px;
            vertical-align: middle;
            cursor: pointer;
            text-decoration: none;
            border: none;
            border-radius: 6px;
            color: #fff;
            line-height: 1;
            transition: all var(--ws3-transition-fast);
        }
        .ws3-collect-inline svg {
            width: 20px;
            height: 20px;
            display: block;
            pointer-events: none;
        }
        .ws3-collect-inline:hover {
            transform: translateY(-1px);
            filter: brightness(1.15);
        }
        .ws3-coll-copy {
            background: linear-gradient(135deg, #4aa3f0, #2563eb);
        }
        .ws3-coll-cmd {
            background: linear-gradient(135deg, #fbbf24, #d97706);
        }
        .ws3-coll-add {
            background: linear-gradient(135deg, #34d399, #059669);
        }
        .ws3-coll-add.ws3-added {
            background: var(--ws3-success) !important;
            color: #fff;
        }
        .ws3-panel {
            position: fixed;
            z-index: 2147483647;
            background: var(--ws3-bg-secondary);
            border: 1px solid var(--ws3-border);
            border-radius: var(--ws3-radius-lg) var(--ws3-radius-lg) 0 0;
            font-family: var(--ws3-font-ui);
            width: max-content;
            min-width: 240px;
            max-width: 480px;
            animation: ws3-panel-in 0.35s cubic-bezier(0.4, 0, 0.2, 1);
            overflow: hidden;
        }
        @keyframes ws3-panel-in {
            from { opacity: 0; transform: translateY(12px) scale(0.96); }
            to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .ws3-panel-header {
            padding: 10px 16px;
            background: var(--ws3-bg-tertiary);
            cursor: move;
            display: flex;
            justify-content: space-between;
            align-items: center;
            user-select: none;
            border-bottom: 1px solid var(--ws3-border);
        }
        .ws3-panel-title {
            color: var(--ws3-accent);
            font-size: 13px;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .ws3-panel-title-icon {
            font-size: 15px;
            line-height: 1;
        }
        .ws3-panel-controls {
            display: flex;
            gap: 4px;
            align-items: center;
        }
        .ws3-panel-btn {
            background: none;
            border: none;
            color: var(--ws3-text-secondary);
            cursor: pointer;
            font-size: 16px;
            padding: 2px 6px;
            line-height: 1;
            border-radius: var(--ws3-radius-sm);
            transition: all var(--ws3-transition-fast);
        }
        .ws3-panel-btn:hover { color: var(--ws3-danger-hover); background: var(--ws3-danger-bg); }
        .ws3-panel-btn.ws3-minimize-btn:hover { color: var(--ws3-accent); background: var(--ws3-accent-bg); }
        .ws3-panel-body {
            padding: 14px 16px;
        }
        .ws3-panel-stats {
            display: flex;
            flex-direction: column;
            gap: 6px;
            margin-bottom: 10px;
            padding: 8px 10px;
            background: rgba(0,0,0,0.18);
            border-radius: var(--ws3-radius);
            border: 1px solid var(--ws3-border);
        }
        .ws3-panel-stats .ws3-panel-stat { margin-bottom: 0; }
        .ws3-panel.ws3-minimized {
            bottom: 0 !important;
            top: auto !important;
            transform: translateY(0);
            transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .ws3-panel.ws3-minimized .ws3-panel-body { display: none; }
        .ws3-panel-stat {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
            font-size: 12px;
            color: var(--ws3-text-secondary);
        }
        .ws3-panel-stat-value {
            color: var(--ws3-accent);
            font-weight: 600;
            font-size: 15px;
        }
        .ws3-panel-progress {
            margin: 10px 0;
        }
        .ws3-panel-progress-bar {
            height: 6px;
            background: var(--ws3-bg-tertiary);
            border-radius: 3px;
            overflow: hidden;
        }
        .ws3-panel-progress-fill {
            height: 100%;
            background: linear-gradient(90deg, var(--ws3-accent), #4a9eff);
            width: 0%;
            transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1);
            border-radius: 3px;
        }
        .ws3-panel-progress-text {
            font-size: 11px;
            color: var(--ws3-text-muted);
            text-align: center;
            margin-top: 4px;
        }
        .ws3-panel-actions {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-top: 10px;
        }
        .ws3-btn {
            flex: 1 1 0%;
            min-height: 34px;
            min-width: 0;
            padding: 8px 12px;
            border: none;
            border-radius: var(--ws3-radius);
            cursor: pointer;
            font-family: var(--ws3-font-ui);
            font-size: 12px;
            font-weight: 600;
            color: #fff;
            text-shadow: 0 1px 3px rgba(0,0,0,0.45);
            transition: all var(--ws3-transition-fast);
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 5px;
            letter-spacing: 0.03em;
            line-height: 1.2;
            box-sizing: border-box;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .ws3-btn:active { transform: scale(0.97); }
        .ws3-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
        .ws3-btn-primary { background: linear-gradient(135deg, #4aa3f0, #2563eb); }
        .ws3-btn-primary:hover:not(:disabled) {
            background: linear-gradient(135deg, #5db3f8, #3b82f6);
            color: #fff;
            text-shadow: 0 1px 2px rgba(0,0,0,0.4);
        }
        .ws3-btn-success { background: linear-gradient(135deg, #34d399, #059669); }
        .ws3-btn-success:hover:not(:disabled) {
            background: linear-gradient(135deg, #4ade80, #10b981);
            text-shadow: 0 1px 2px rgba(0,0,0,0.4);
        }
        .ws3-btn-warning { background: linear-gradient(135deg, #fbbf24, #d97706); }
        .ws3-btn-warning:hover:not(:disabled) {
            background: linear-gradient(135deg, #fcd34d, #f59e0b);
            color: #1a1a1a;
            text-shadow: none;
        }
        .ws3-btn-purple { background: linear-gradient(135deg, #a78bfa, #7c3aed); }
        .ws3-btn-purple:hover:not(:disabled) {
            background: linear-gradient(135deg, #c4b5fd, #8b5cf6);
            text-shadow: 0 1px 2px rgba(0,0,0,0.4);
        }
        .ws3-btn-secondary {
            background: #1e2a3a;
            color: #cbd5e1;
            border: 1px solid rgba(148,163,184,0.3);
        }
        .ws3-btn-secondary:hover:not(:disabled) {
            background: #293548;
            border-color: rgba(148,163,184,0.55);
            color: #f1f5f9;
        }
        .ws3-btn-danger { background: linear-gradient(135deg, #f87171, #dc2626); }
        .ws3-btn-danger:hover:not(:disabled) {
            background: linear-gradient(135deg, #fca5a5, #ef4444);
            text-shadow: 0 1px 2px rgba(0,0,0,0.4);
        }
        .ws3-btn-accent { background: linear-gradient(135deg, #66c0f4, #3182ce); }
        .ws3-btn-added { background: linear-gradient(135deg, #1f6b43, #145c34); color: #d6f5e1; border: 1px solid var(--ws3-success); }
        .ws3-btn-added:hover:not(:disabled) { background: linear-gradient(135deg, #218a52, #16693c); }
        .ws3-btn-accent:hover:not(:disabled) {
            background: linear-gradient(135deg, #93d5ff, #4299e1);
            text-shadow: 0 1px 2px rgba(0,0,0,0.4);
        }
        .ws3-btn-sm {
            padding: 6px 12px;
            font-size: 11px;
            border-radius: var(--ws3-radius-sm);
            min-width: auto;
            line-height: 1.25;
        }
        .ws3-btn-compact {
            flex: 0 0 auto;
            padding: 4px 10px;
            min-width: 0;
        }
        .ws3-btn-uniform { flex: 1 1 0; min-width: 0; text-align: center; }
        .ws3-panel-log {
            font-size: 11px;
            padding: 8px 10px;
            background: rgba(0,0,0,0.25);
            border-radius: var(--ws3-radius);
            margin-top: 10px;
            color: var(--ws3-text-secondary);
            max-height: 110px;
            overflow-y: auto;
            font-family: var(--ws3-font-mono);
            line-height: 1.55;
        }
        .ws3-panel-log .ws3-log-success { color: var(--ws3-success-hover); }
        .ws3-panel-log .ws3-log-error { color: var(--ws3-danger-hover); }
        .ws3-panel-log .ws3-log-warning { color: var(--ws3-warning-hover); }
        .ws3-panel-log .ws3-log-info { color: var(--ws3-accent); }
        .ws3-modal-backdrop {
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.6);
            z-index: 2147483646;
            display: flex;
            align-items: center;
            justify-content: center;
            animation: ws3-backdrop-in 0.25s ease;
            user-select: none;
            -webkit-user-select: none;
            overflow: auto;
        }
        .ws3-modal-backdrop::-webkit-scrollbar { width: 0; height: 0; }
        @keyframes ws3-backdrop-in {
            from { opacity: 0; }
            to { opacity: 1; }
        }
        .ws3-modal {
            background: var(--ws3-bg-primary);
            border: 1px solid var(--ws3-border);
            border-radius: var(--ws3-radius-xl);
            box-shadow: none;
            width: 860px !important;
            min-width: 860px !important;
            max-width: 95vw !important;
            height: 85vh;
            min-height: 55vh;
            max-height: 92vh;
            display: flex;
            flex-direction: column;
            animation: ws3-modal-in 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            overflow: hidden;
        }
        @keyframes ws3-modal-in {
            from { opacity: 0; transform: translateY(20px) scale(0.95); }
            to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .ws3-modal-header {
            padding: 10px 18px;
            background: var(--ws3-bg-tertiary);
            border-bottom: 1px solid var(--ws3-border);
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-shrink: 0;
        }
        .ws3-modal-title {
            color: var(--ws3-accent);
            font-size: 14px;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .ws3-type-toggle {
            display: inline-flex;
            margin-left: 8px;
            border: 1px solid var(--ws3-border);
            border-radius: 6px;
            overflow: hidden;
            background: var(--ws3-bg-tertiary);
            flex-shrink: 0;
        }
        .ws3-type-btn {
            border: none;
            background: transparent;
            color: var(--ws3-text-muted);
            font-size: 11px;
            padding: 2px 10px;
            cursor: pointer;
            line-height: 1.6;
            transition: background .15s, color .15s;
            white-space: nowrap;
        }
        .ws3-type-btn:hover {
            color: var(--ws3-text-primary);
        }
        .ws3-type-btn.is-active {
            background: var(--ws3-accent);
            color: #fff;
        }
        .ws3-modal-close {
            background: none;
            border: none;
            color: var(--ws3-text-secondary);
            font-size: 20px;
            cursor: pointer;
            padding: 1px 6px;
            border-radius: var(--ws3-radius-sm);
            transition: all var(--ws3-transition-fast);
            line-height: 1;
        }
        .ws3-modal-close:hover {
            color: var(--ws3-danger-hover);
            background: var(--ws3-danger-bg);
        }
        .ws3-modal-toolbar {
            padding: 8px 16px;
            background: var(--ws3-bg-secondary);
            border-bottom: 1px solid var(--ws3-border);
            display: flex;
            flex-direction: column;
            gap: 6px;
            flex-shrink: 0;
        }
        .ws3-toolbar-row {
            display: flex;
            gap: 8px;
            align-items: center;
            flex-wrap: wrap;
        }
        .ws3-search-wrap {
            flex: 1;
            min-width: 180px;
            position: relative;
        }
        .ws3-filter-select {
            font-family: var(--ws3-font-ui);
            cursor: pointer;
            min-width: 138px;
        }
        .ws3-filter-select:hover {
            border-color: var(--ws3-accent);
        }
        .ws3-search-icon {
            position: absolute;
            left: 10px;
            top: 50%;
            transform: translateY(-50%);
            color: var(--ws3-text-muted);
            font-size: 13px;
            pointer-events: none;
            z-index: 1;
        }
        .ws3-search-input {
            width: 100%;
            padding: 7px 30px 7px 30px;
            background: var(--ws3-bg-tertiary);
            border: 1px solid var(--ws3-border);
            border-radius: var(--ws3-radius);
            color: var(--ws3-text-primary);
            font-family: var(--ws3-font-ui);
            font-size: 13px;
            outline: none;
            transition: border-color var(--ws3-transition-fast);
            box-sizing: border-box;
        }
        .ws3-search-input:focus {
            border-color: var(--ws3-accent);
            box-shadow: 0 0 0 2px rgba(102,192,244,0.2);
        }
        .ws3-search-input::placeholder {
            color: var(--ws3-text-muted);
        }
        .ws3-search-clear {
            position: absolute;
            right: 6px;
            top: 50%;
            transform: translateY(-50%);
            cursor: pointer;
            color: var(--ws3-text-muted);
            font-size: 16px;
            line-height: 1;
            padding: 2px 4px;
            border-radius: 3px;
            transition: color var(--ws3-transition-fast);
            user-select: none;
        }
        .ws3-search-clear:hover {
            color: var(--ws3-text-primary);
            background: rgba(128,128,128,0.15);
        }
        .ws3-table th.ws3-sortable { cursor: pointer; user-select: none; transition: background var(--ws3-transition-fast), color var(--ws3-transition-fast); }
        .ws3-table th.ws3-sortable:hover { background: var(--ws3-bg-hover); color: var(--ws3-text-primary); }
        .ws3-table th.ws3-sortable.active { color: var(--ws3-accent); border-bottom-color: var(--ws3-accent); }
        .ws3-sort-arrow { display: inline-block; margin-left: 4px; font-size: 10px; line-height: 1; color: var(--ws3-text-muted); transition: color var(--ws3-transition-fast); }
        .ws3-table th.ws3-sortable.active .ws3-sort-arrow { color: var(--ws3-accent); }
        .ws3-modal-body {
            flex: 1 1 0;
            min-height: 0;
            overflow-y: auto;
            overflow-x: hidden;
            padding: 0 !important;
            margin: 0 !important;
            position: relative;
        }
        .ws3-modal-body::-webkit-scrollbar {
            width: 10px;
            height: 10px;
        }
        .ws3-modal-body::-webkit-scrollbar-track {
            background: #16202d;
        }
        .ws3-modal-body::-webkit-scrollbar-thumb {
            background: #354f6e;
            border-radius: 5px;
        }
        .ws3-modal-body::-webkit-scrollbar-thumb:hover {
            background: #4a6a90;
        }
        .ws3-poster-flyout {
            position: fixed;
            z-index: 2147483647;
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.2s ease;
            border: none;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: none;
            background: #111;
            max-width: 380px;
            max-height: 260px;
        }
        .ws3-poster-flyout.show { opacity: 1; }
        .ws3-poster-flyout img {
            width: 100%;
            height: 100%;
            object-fit: contain;
            display: block;
        }
        .ws3-countdown {
            position: fixed;
            width: 24px;
            height: 24px;
            pointer-events: none;
            z-index: 2147483647;
        }
        .ws3-countdown circle {
            fill: none;
            stroke: var(--ws3-accent);
            stroke-width: 2;
            stroke-linecap: round;
            transform-origin: center;
        }
        .ws3-countdown.spinning {
            animation: ws3-ring-spin 0.8s linear infinite;
        }
        @keyframes ws3-ring-spin {
            from { transform: rotate(0deg); }
            to   { transform: rotate(360deg); }
        }
        .ws3-table {
            width: 100% !important;
            min-width: 100% !important;
            max-width: none !important;
            table-layout: fixed;
            border-collapse: collapse;
            font-size: 14px;
            color: var(--ws3-text-primary);
            box-sizing: border-box;
        }
        .ws3-table thead {
            position: sticky;
            top: 0;
            z-index: 1;
        }
        .ws3-table th {
            background: var(--ws3-bg-tertiary);
            padding: 1px 6px;
            text-align: left;
            font-weight: 600;
            color: var(--ws3-text-secondary);
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            border-bottom: 2px solid var(--ws3-border);
            white-space: nowrap;
        }
        .ws3-table td {
            padding: 6px 6px;
            border-bottom: 1px solid rgba(53, 79, 110, 0.45);
            transition: background var(--ws3-transition-fast);
            vertical-align: middle;
            font-size: 14px;
        }
        .ws3-table tbody tr {
            transition: background var(--ws3-transition-fast);
            min-height: 20px;
        }
        .ws3-table tbody tr:hover {
            background: rgba(255, 255, 255, 0.08);
        }
        .ws3-table tbody tr.selected {
            background: rgba(102, 192, 244, 0.22);
        }
        .ws3-table tbody tr.ws3-row-selected {
            background: rgba(102, 192, 244, 0.22);
        }
        .ws3-table tbody tr:has(.ws3-item-checkbox:checked) {
            background: rgba(102, 192, 244, 0.18);
        }
        .ws3-table tbody tr.ws3-row-boxed {
            background: rgba(110, 231, 222, 0.18);
            box-shadow: inset 0 0 0 2px rgba(110, 231, 222, 0.7);
        }
        .ws3-table tbody tr.ws3-row-updated {
            background: rgba(72, 199, 142, 0.12);
        }
        .ws3-table tbody tr.ws3-row-updated .ws3-col-date {
            color: var(--ws3-accent);
            font-weight: 600;
        }
        .ws3-col-check { width: 36px !important; min-width: 36px !important; text-align: center; vertical-align: middle; }
        .ws3-col-check .ws3-checkbox { vertical-align: middle !important; }
        .ws3-col-name { min-width: 180px; vertical-align: middle; }
        .ws3-col-id { width: 104px !important; font-family: var(--ws3-font-mono); font-size: 14px !important; font-weight: 400; color: var(--ws3-text-secondary); vertical-align: middle; text-align: left !important; }
        .ws3-col-id a { color: inherit; }
        .ws3-col-date { width: 116px !important; font-size: 12px; color: var(--ws3-text-secondary); font-weight: 400; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; vertical-align: middle; text-align: left; font-feature-settings: 'tnum'; letter-spacing: 0; }
        .ws3-col-time { width: 100px !important; font-size: 12px; color: var(--ws3-text-secondary); font-weight: 400; white-space: nowrap; vertical-align: middle; text-align: left; }
        .ws3-col-actions { width: 160px !important; white-space: nowrap; vertical-align: middle; text-align: left; }
        .ws3-table th.ws3-col-id,
        .ws3-table th.ws3-col-date,
        .ws3-table th.ws3-col-time,
        .ws3-table th.ws3-col-actions { text-align: left; padding-left: 4px; padding-right: 4px; }
        .ws3-table th.ws3-col-check { text-align: center; }
        .ws3-table .ws3-item-name {
            max-width: 280px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            display: block;
            color: var(--ws3-text-secondary);
            font-size: 14px;
        }
        .ws3-table .ws3-item-link {
            color: var(--ws3-text-secondary);
            text-decoration: none;
            font-family: var(--ws3-font-mono);
            font-weight: 400;
        }
        .ws3-table .ws3-item-link:hover {
            color: var(--ws3-accent);
            text-decoration: underline;
        }
        .ws3-table .ws3-row-btn {
            background: none;
            border: 1px solid var(--ws3-border);
            color: var(--ws3-text-secondary);
            padding: 4px 8px;
            border-radius: var(--ws3-radius-sm);
            cursor: pointer;
            font-size: 11px;
            line-height: 1;
            transition: all var(--ws3-transition-fast);
            margin-left: 3px;
            vertical-align: middle !important;
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
        }
        .ws3-table .ws3-row-btn:hover {
            border-color: var(--ws3-border-light);
            color: var(--ws3-text-primary);
            background: var(--ws3-bg-hover);
        }
        .ws3-table .ws3-row-btn.ws3-row-delete {
            color: #ef4444;
            font-size: 13px;
        }
        .ws3-table .ws3-row-btn.ws3-row-delete:hover {
            border-color: var(--ws3-danger);
            color: var(--ws3-danger-hover);
            background: var(--ws3-danger-bg);
        }
        .ws3-table .ws3-row-btn.ws3-row-delete-confirm {
            color: #fff !important;
            background: #dc2626 !important;
            border-color: #dc2626 !important;
            box-shadow: 0 0 8px rgba(220,38,38,0.6);
            animation: ws3-delete-pulse 0.8s infinite;
        }
        @keyframes ws3-delete-pulse {
            0%, 100% { box-shadow: 0 0 4px rgba(220,38,38,0.4); }
            50% { box-shadow: 0 0 12px rgba(220,38,38,0.8); }
        }
        .ws3-modal-footer {
            padding: 8px 18px;
            border-top: 1px solid var(--ws3-border);
            background: var(--ws3-bg-secondary);
            display: flex;
            flex-wrap: wrap;
            justify-content: space-between;
            align-items: center;
            gap: 12px;
            flex-shrink: 0;
        }
        .ws3-footer-info {
            color: var(--ws3-text-secondary);
            font-size: 11px;
            display: flex;
            align-items: center;
            gap: 4px;
            flex-shrink: 0;
        }
        .ws3-footer-info span {
            display: flex;
            align-items: center;
            gap: 4px;
        }
        .ws3-footer-actions {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 8px;
            flex: 1 1 auto;
            min-width: 0;
        }
        .ws3-footer-actions > * { margin-right: 0; }
        .ws3-footer-actions > .ws3-export-wrap { width: 100%; }
        .ws3-footer-actions > .ws3-export-wrap > .ws3-btn { width: 100%; }
        .ws3-toolbar-row-bottom {
            display: grid;
            grid-template-columns: auto auto repeat(5, 1fr);
            align-items: center;
        }
        .ws3-toolbar-row-bottom > .ws3-more-wrap { width: 100%; }
        .ws3-toolbar-row-bottom > .ws3-more-wrap > .ws3-btn { width: 100%; }
        .ws3-toolbar-row-top {
            display: grid;
            grid-template-columns: 1fr auto auto;
            align-items: center;
        }
        .ws3-toolbar-row > .ws3-more-wrap { flex: 1 1 0; min-width: 0; }
        .ws3-toolbar-row > .ws3-more-wrap > .ws3-btn { width: 100%; }
        .ws3-export-wrap { position: relative; display: inline-block; }
        .ws3-export-menu {
            position: absolute;
            bottom: calc(100% + 6px);
            right: 0;
            min-width: 176px;
            background: var(--ws3-bg-tertiary);
            border: 1px solid var(--ws3-border);
            border-radius: 8px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.45);
            padding: 6px;
            z-index: 50;
        }
        .ws3-export-item { position: relative; }
        .ws3-export-item > span {
            display: flex; align-items: center; justify-content: space-between;
            padding: 7px 10px; border-radius: 6px; cursor: pointer;
            color: var(--ws3-text-primary); font-size: 12px; white-space: nowrap;
        }
        .ws3-export-item > span:hover { background: var(--ws3-bg-hover); }
        .ws3-export-caret { color: var(--ws3-text-muted); font-size: 10px; margin-left: 10px; }
        .ws3-export-sub {
            display: none;
            position: absolute;
            left: calc(100% + 6px);
            right: auto;
            top: -6px;
            min-width: 120px;
            background: var(--ws3-bg-tertiary);
            border: 1px solid var(--ws3-border);
            border-radius: 8px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.45);
            padding: 6px;
        }
        .ws3-export-sub::before {
            content: '';
            position: absolute;
            top: 0;
            left: -6px;
            width: 6px;
            height: 100%;
        }
        .ws3-export-item:hover .ws3-export-sub { display: block; }
        .ws3-export-sub button {
            display: block; width: 100%; text-align: left;
            background: transparent; border: none; color: var(--ws3-text-primary);
            padding: 7px 10px; border-radius: 6px; cursor: pointer; font-size: 12px; white-space: nowrap;
        }
        .ws3-export-sub button:hover { background: var(--ws3-bg-hover); }
        .ws3-more-wrap { position: relative; display: inline-block; }
        .ws3-more-menu {
            display: none;
            position: absolute;
            bottom: calc(100% + 6px);
            right: 0;
            min-width: 180px;
            background: var(--ws3-bg-tertiary);
            border: 1px solid var(--ws3-border);
            border-radius: 8px;
            box-shadow: 0 8px 28px rgba(0,0,0,0.55);
            padding: 6px;
            z-index: 50;
            flex-direction: column;
        }
        .ws3-more-wrap.is-open .ws3-more-menu { display: flex; }
        .ws3-more-menu button {
            width: 100%;
            justify-content: flex-start;
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 8px 14px;
            margin: 2px 0;
            border: none;
            border-radius: 6px;
            background: transparent;
            color: var(--ws3-text-primary);
            font-family: var(--ws3-font-ui);
            font-size: 12px;
            cursor: pointer;
            transition: background var(--ws3-transition-fast);
            white-space: nowrap;
        }
        .ws3-more-menu button:hover {
            background: rgba(255,255,255,0.1);
            color: #fff;
        }
        .ws3-empty-state {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 60px 20px;
            color: var(--ws3-text-muted);
            text-align: center;
        }
        .ws3-empty-state-icon {
            font-size: 48px;
            margin-bottom: 16px;
            opacity: 0.5;
        }
        .ws3-empty-state-text {
            font-size: 14px;
            margin-bottom: 4px;
        }
        .ws3-empty-state-sub {
            font-size: 12px;
            opacity: 0.7;
        }
        .ws3-confirm-bar {
            padding: 8px 16px;
            background: var(--ws3-danger-bg);
            border-bottom: 1px solid rgba(231,76,60,0.3);
            color: var(--ws3-text-primary);
            font-size: 12px;
            display: flex;
            align-items: center;
            gap: 10px;
            flex-shrink: 0;
            animation: ws3-confirm-in 0.2s ease;
        }
        @keyframes ws3-confirm-in {
            from { opacity: 0; transform: translateY(-4px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .ws3-confirm-bar .ws3-confirm-msg {
            flex: 1;
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .ws3-confirm-bar .ws3-confirm-actions {
            display: flex;
            gap: 8px;
            flex-shrink: 0;
        }
        .ws3-select-rect {
            position: fixed;
            border: 1px dashed var(--ws3-accent);
            background: rgba(102, 192, 244, 0.08);
            pointer-events: none;
            z-index: 2147483647;
        }
        .ws3-checkbox {
            appearance: none !important;
            -webkit-appearance: none !important;
            width: 13px !important;
            height: 13px !important;
            min-width: 13px !important;
            min-height: 13px !important;
            max-width: 13px !important;
            max-height: 13px !important;
            border: none !important;
            box-shadow: 0 0 0 2px #7e8fa0 !important;
            border-radius: 3px !important;
            background: rgba(40, 50, 65, 0.5) !important;
            cursor: pointer !important;
            transition: all var(--ws3-transition-fast);
            position: relative !important;
            vertical-align: middle !important;
            display: inline-block !important;
            padding: 0 !important;
            margin: 0 !important;
            box-sizing: border-box !important;
            flex-shrink: 0 !important;
        }
        .ws3-checkbox:hover {
            box-shadow: 0 0 0 2px var(--ws3-accent) !important;
            background: rgba(60, 80, 110, 0.6) !important;
        }
        .ws3-checkbox:checked {
            background: rgba(59, 130, 246, 0.25) !important;
            box-shadow: 0 0 0 2px #7e8fa0 !important;
        }
        .ws3-checkbox:checked::after {
            content: '';
            position: absolute;
            left: 4px;
            top: 1px;
            width: 4px;
            height: 8px;
            border: solid #fff;
            border-width: 0 2px 2px 0;
            transform: rotate(45deg);
        }
        .ws3-table td.ws3-col-check .ws3-seq-check {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 36px;
            height: 20px;
            box-sizing: border-box;
            padding: 0;
            gap: 0;
            border: 2px solid #6b7d90;
            border-radius: 4px;
            background: rgba(30, 42, 56, 0.6);
            cursor: pointer;
            vertical-align: middle;
            user-select: none;
            position: relative;
            transition: background var(--ws3-transition-fast), border-color var(--ws3-transition-fast), transform .1s ease;
        }
        .ws3-table td.ws3-col-check .ws3-seq-check:hover {
            background: rgba(40, 55, 72, 0.75);
            border-color: #6ee7de;
        }
        .ws3-table td.ws3-col-check .ws3-seq-check > .ws3-checkbox {
            display: block !important;
            appearance: none !important;
            -webkit-appearance: none !important;
            opacity: 0;
            position: absolute;
            inset: 0;
            width: 100% !important;
            height: 100% !important;
            min-width: 100% !important;
            max-width: 100% !important;
            min-height: 100% !important;
            max-height: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            border: none !important;
            box-shadow: none !important;
            background: transparent !important;
            cursor: pointer !important;
            z-index: 2;
        }
        .ws3-table td.ws3-col-check .ws3-seq {
            position: absolute;
            inset: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            font-family: var(--ws3-font-mono);
            font-size: 11px;
            line-height: 1;
            font-weight: 600;
            color: #9fb1c0;
            letter-spacing: 0;
            text-align: center;
            white-space: nowrap;
            font-variant-numeric: tabular-nums;
            pointer-events: none;
            z-index: 1;
        }
        .ws3-table td.ws3-col-check .ws3-seq-check:has(.ws3-checkbox:checked) {
            background: rgba(16, 185, 129, 0.9);
            border-color: #10b981;
        }
        .ws3-table td.ws3-col-check .ws3-seq-check:has(.ws3-checkbox:checked) .ws3-seq {
            color: #000;
            font-weight: 700;
        }
        .ws3-table th.ws3-col-check .ws3-checkbox {
            appearance: none !important;
            -webkit-appearance: none !important;
            width: 18px !important;
            height: 18px !important;
            min-width: 18px !important;
            min-height: 18px !important;
            border: 2px solid #6b7d90 !important;
            border-radius: 4px !important;
            background: rgba(30, 42, 56, 0.6) !important;
            box-shadow: none !important;
            cursor: pointer !important;
            position: relative !important;
            display: inline-block !important;
            padding: 0 !important;
            margin: 0 !important;
            vertical-align: middle !important;
        }
        .ws3-table th.ws3-col-check .ws3-checkbox:hover { background: rgba(40,55,72,.75) !important; border-color: #6ee7de !important; }
        .ws3-table th.ws3-col-check .ws3-checkbox:checked { background: rgba(59, 130, 246, 0.25) !important; border-color: #6b7d90 !important; box-shadow: none !important; }
        .ws3-table th.ws3-col-check .ws3-checkbox:checked::after {
            content: ''; position: absolute; left: 5px; top: 2px;
            width: 4px; height: 8px; border: solid #16202d; border-width: 0 2px 2px 0;
            transform: rotate(45deg);
        }
        .ws3-panel-log::-webkit-scrollbar {
            width: 4px;
        }
        .ws3-panel-log::-webkit-scrollbar-track {
            background: transparent;
        }
        .ws3-panel-log::-webkit-scrollbar-thumb {
            background: var(--ws3-border);
            border-radius: 2px;
        }
        /* 分页：滚轮按钮 + 自定义页码显示（无 input） */
        .ws3-wheel-box{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;margin-left:2px;border:1px solid rgba(255,255,255,.12);border-radius:5px;background:#1b2735;cursor:pointer;transition:all .12s;position:relative;}
        .ws3-wheel-box:hover,.ws3-wheel-box.is-active{border-color:#66c0f4;background:rgba(102,192,244,.15);box-shadow:0 0 8px rgba(102,192,244,.45);}
        .ws3-wheel-icon{width:16px;height:16px;stroke:#9fb3c8;transition:stroke .12s;}
        .ws3-wheel-box:hover .ws3-wheel-icon,.ws3-wheel-box.is-active .ws3-wheel-icon{stroke:#66c0f4;}
        .ws3-wheel-tooltip{position:absolute;bottom:130%;left:50%;transform:translateX(-50%);background:#0e1620;border:1px solid rgba(255,255,255,.2);color:#c7d5e0;font-size:11px;padding:4px 8px;border-radius:5px;white-space:nowrap;opacity:0;pointer-events:none;transition:opacity .12s;}
        .ws3-wheel-box:hover .ws3-wheel-tooltip{opacity:1;}
        .ws3-page-display{display:inline-flex;align-items:baseline;gap:2px;margin-left:0;padding:3px 6px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;color:#c7d5e0;background:#1b2735;border:1px solid transparent;border-radius:5px;cursor:text;user-select:none;}
        .ws3-page-display:hover{border-color:rgba(255,255,255,.12);}
        .ws3-page-display:focus-visible{outline:none;border-color:#66c0f4;box-shadow:0 0 0 2px rgba(102,192,244,.25);}
        .ws3-digit{padding:0 1px;transition:background .12s;}
        .ws3-digit.is-selected{color:#fff;background:#66c0f4;border-radius:2px;}
        .ws3-page-caret{width:1px;height:12px;background:#66c0f4;margin-left:1px;opacity:0;}
        .ws3-page-caret.is-blink{animation:ws3-blink 1s step-end infinite;opacity:1;}
        @keyframes ws3-blink{50%{opacity:0;}}
        .ws3-page-total{color:#7d8fa0;margin-left:2px;}
        .ws3-page-display.is-reject{color:#ff6b6b;border-color:#ff6b6b;box-shadow:0 0 0 2px rgba(255,107,107,.3);}
    `);
    /* 分区 5 · 页面识别：基于 URL 精准识别当前 Steam 页面类型，提取 AppID / 用户ID / 模组ID，并动态监听 URL 变化 */
    const PageDetector = {
        _typeCache: null,
        _appIdCache: null,
        _userIdCache: null,
        _itemIdCache: null,
        _lastUrl: null,
        _urlHandler: null,
        _historyPatched: false,
        _pollTimer: null,
        getType() {
            if (this._typeCache) return this._typeCache;
            const loc = window.location;
            if (!/steamcommunity\.com$/.test(loc.hostname)) { this._typeCache = 'unknown'; return 'unknown'; }
            const path = loc.pathname;
            const url = new URL(loc.href);
            if (/\/myworkshopfiles(\/|$)/.test(path)) {
                this._typeCache = 'workshopitem';
                return 'workshopitem';
            }
            if (/\/sharedfiles\/filedetails\//.test(path)) {
                this._typeCache = this._detectDetailType();
                return this._typeCache;
            }
            if (/\/workshop\/browse\//.test(path)) {
                const section = url.searchParams.get('section');
                this._typeCache = (section === 'collections') ? 'collectionBrowse' : 'workshop';
                return this._typeCache;
            }
            if (/\/app\/\d+\/workshop/.test(path)) {
                this._typeCache = 'workshop';
                return 'workshop';
            }
            this._typeCache = 'unknown';
            return 'unknown';
        },
        _detectDetailType() {
            if (document.querySelector('.collectionChildren') ||
                document.querySelector('#mainContentsCollectionTop') ||
                document.querySelector('.collectionTopNoBackgroundImage') ||
                document.querySelector('.collectionBackgroundImage')) {
                return 'collection';
            }
            return 'item';
        },
        isWorkshopPage() {
            if (!/steamcommunity\.com$/.test(window.location.hostname)) return false;
            return this.getType() !== 'unknown';
        },
        invalidate() {
            this._typeCache = null;
            this._appIdCache = null;
            this._userIdCache = null;
            this._itemIdCache = null;
            this._lastUrl = window.location.href;
        },
        getAppId() {
            if (this._appIdCache !== null) return this._appIdCache;
            const fromUrl = new URL(window.location.href).searchParams.get('appid');
            if (fromUrl && /^\d+$/.test(fromUrl)) { this._appIdCache = fromUrl; return fromUrl; }
            const storeLink = document.querySelector('a[href*="/app/"]');
            if (storeLink) { const m = storeLink.href.match(/\/app\/(\d+)/); if (m) { this._appIdCache = m[1]; return m[1]; } }
            const subBtn = document.querySelector('#SubscribeItemBtn');
            if (subBtn) {
                const m = (subBtn.getAttribute('onclick') || '').match(/SubscribeItem\s*\(\s*'\d+'\s*,\s*'(\d+)'\s*\)/);
                if (m) { this._appIdCache = m[1]; return m[1]; }
            }
            const anySub = document.querySelector('[onclick*="SubscribeItem"], [onclick*="SubscribeCollectionItem"]');
            if (anySub) {
                const m = (anySub.getAttribute('onclick') || '').match(/Sub(?:scribeItem|scribeCollectionItem)\s*\(\s*'\d+'\s*,\s*'(\d+)'\s*\)/);
                if (m) { this._appIdCache = m[1]; return m[1]; }
            }
            const breadcrumb = document.querySelector('.breadcrumbs a[href*="/app/"]');
            if (breadcrumb) { const m = breadcrumb.href.match(/\/app\/(\d+)/); if (m) { this._appIdCache = m[1]; return m[1]; } }
            const pathMatch = window.location.pathname.match(/\/app\/(\d+)/);
            if (pathMatch) { this._appIdCache = pathMatch[1]; return pathMatch[1]; }
            this._appIdCache = null;
            return null;
        },
        getUserId() {
            if (this._userIdCache !== null) return this._userIdCache;
            const m = window.location.pathname.match(/\/(?:profiles|id)\/([^/]+)\/myworkshopfiles/);
            this._userIdCache = m ? m[1] : null;
            return this._userIdCache;
        },
        getItemId() {
            if (this._itemIdCache !== null) return this._itemIdCache;
            if (typeof publishedfileid !== 'undefined' && publishedfileid) { this._itemIdCache = String(publishedfileid); return this._itemIdCache; }
            const m = new URL(window.location.href).searchParams.get('id');
            this._itemIdCache = m || null;
            return this._itemIdCache;
        },
        getSteamCmd(id) {
            return `workshop_download_item ${this.getAppId() || '<APPID>'} ${id}`;
        },
        getSteamCmdText(ids) {
            const appId = this.getAppId();
            if (!appId) {
                return ids.map(id => `# 请手动替换 APPID\nworkshop_download_item <APPID> ${id}`).join('\n');
            }
            return ids.map(id => `workshop_download_item ${appId} ${id}`).join('\n');
        },
        getGameName() {
            const appLink = document.querySelector('a[data-panel][href*="/app/"]');
            if (appLink) { const t = (appLink.textContent || '').trim(); if (t && t.length > 1 && t.length < 60) return t; }
            const appHub = document.querySelector('.apphub_AppName');
            if (appHub) { const t = (appHub.textContent || '').trim(); if (t && t.length > 1 && t.length < 60) return t; }
            const h1 = document.querySelector('h1');
            if (h1) { const t = (h1.textContent || '').trim(); if (t && t.length > 1 && t.length < 60) return t; }
            const searchInput = document.querySelector('input[placeholder*="搜索"], input[placeholder*="Search"]');
            if (searchInput) {
                const ph = searchInput.getAttribute('placeholder') || '';
                const m = ph.match(/(?:搜索|Search|search)\s+(.+)/);
                if (m) { const t = m[1].trim(); if (t && t.length < 60) return t; }
            }
            const searchedDiv = document.querySelector('#searchedForApp');
            if (searchedDiv) {
                const img = searchedDiv.querySelector('img');
                const txt = searchedDiv.textContent || '';
                const alt = img ? (img.getAttribute('alt') || '') : '';
                const clean = img ? txt.replace(alt, '').trim() : txt.trim();
                if (clean && clean.length > 1 && clean.length < 60) return clean;
            }
            const headerApp = document.querySelector('.HeaderUserInfoSection a[href*="/myworkshopfiles/"]');
            if (headerApp) { const t = (headerApp.textContent || '').trim(); if (t && t.length > 1 && t.length < 60) return t; }
            return null;
        },
        watchUrl(handler) {
            if (this._urlHandler) return;
            this._urlHandler = handler;
            this._lastUrl = window.location.href;
            const self = this;
            const onMaybeChanged = () => {
                const cur = window.location.href;
                if (cur === self._lastUrl) return;
                self._lastUrl = cur;
                self.invalidate();
                if (self._urlHandler) self._urlHandler(self.getType(), cur);
            };
            if (!this._historyPatched) {
                ['pushState', 'replaceState'].forEach((method) => {
                    const orig = window.history[method];
                    window.history[method] = function (...args) {
                        const ret = orig.apply(this, args);
                        onMaybeChanged();
                        return ret;
                    };
                });
                window.addEventListener('popstate', onMaybeChanged);
                window.addEventListener('hashchange', onMaybeChanged);
                this._historyPatched = true;
            }
            if (this._pollTimer) clearInterval(this._pollTimer);
            this._pollTimer = setInterval(onMaybeChanged, 1000);
        }
    };
    /* 分区 6 · 轻提示组件：在页面顶部展示成功 / 警告 / 错误轻提示 */
    const Toast = {
        _container: null,
        _ensureContainer() {
            if (!this._container || !document.body.contains(this._container)) {
                this._container = document.createElement('div');
                this._container.className = 'ws3-toast-container';
                document.documentElement.appendChild(this._container);
            }
        },
        show(msg, type = 'info', duration = 3000) {
            this._ensureContainer();
            const el = document.createElement('div');
            el.className = `ws3-toast ws3-toast-${type}`;
            el.textContent = msg;
            this._container.appendChild(el);
            setTimeout(() => {
                el.classList.add('removing');
                setTimeout(() => el.remove(), 250);
            }, duration);
        },
        success(msg, duration) { this.show(msg, 'success', duration); },
        error(msg, duration) { this.show(msg, 'error', duration); },
        warning(msg, duration) { this.show(msg, 'warning', duration); }
    };
    /* 分区 7 · 本地存储管理：模组 ID、时间戳、海报、游戏名等本地存储的读写、删除与收藏通知 */
    const Store = {
        _saveTimer: null,
        _listeners: [],
        onChange(fn) {
            this._listeners.push(fn);
            return () => {
                this._listeners = this._listeners.filter(f => f !== fn);
            };
        },
        _notify() {
            this._listeners.forEach(fn => { try { fn(); } catch (e) { } });
        },
        loadItems() {
            const raw = GM_getValue(CFG._key(KEYS.ITEMS), '{}');
            try {
                const obj = JSON.parse(raw);
                return typeof obj === 'object' && obj !== null && !Array.isArray(obj) ? obj : {};
            } catch (e) {
                return {};
            }
        },
        saveItems(items) {
            clearTimeout(this._saveTimer);
            this._saveTimer = setTimeout(() => {
                GM_setValue(CFG._key(KEYS.ITEMS), JSON.stringify(items));
                this._notify();
            }, CFG.DEBOUNCE_SAVE);
        },
        saveItemsSync(items) {
            GM_setValue(CFG._key(KEYS.ITEMS), JSON.stringify(items));
            this._notify();
        },
        loadTimestamps() {
            try { return JSON.parse(GM_getValue(CFG._key(CFG.STORAGE_TIMESTAMPS), '{}')); } catch (e) { return {}; }
        },
        saveTimestamps(ts) {
            GM_setValue(CFG._key(CFG.STORAGE_TIMESTAMPS), JSON.stringify(ts));
        },
        addItemsSync(newItems) {
            const items = this.loadItems();
            const stamps = this.loadTimestamps();
            const now = Date.now();
            let added = 0;
            for (const [id, name] of Object.entries(newItems)) {
                if (!Object.prototype.hasOwnProperty.call(items, id)) {
                    items[id] = name || '未知名称';
                    stamps[id] = now;
                    added++;
                }
            }
            if (added > 0) {
                this.saveItemsSync(items);
                this.saveTimestamps(stamps);
                const gameName = PageDetector.getGameName();
                if (gameName) this.saveGameName(PageDetector.getAppId(), gameName);
            }
            return added;
        },
        removeItems(ids) {
            const items = this.loadItems();
            const stamps = this.loadTimestamps();
            const dates = this.loadItemDates();
            let removed = 0;
            ids.forEach(id => {
                if (Object.prototype.hasOwnProperty.call(items, id)) {
                    delete items[id];
                    removed++;
                }
                if (Object.prototype.hasOwnProperty.call(stamps, id)) delete stamps[id];
                if (Object.prototype.hasOwnProperty.call(dates, id)) delete dates[id];
            });
            if (removed > 0) {
                this.saveItemsSync(items);
                this.saveTimestamps(stamps);
                GM_setValue(CFG._key(KEYS.ITEM_DATES), JSON.stringify(dates));
                this._clearPosterCache(ids);
                this._clearItemDescriptions(ids);
                if (Object.keys(this.loadItems()).length === 0) {
                    this.removeGameName(CFG._appId);
                }
            }
            return removed;
        },
        _STORAGE_PREFIXES: [
            KEYS.ITEMS_PREFIX, KEYS.TIMESTAMPS_PREFIX, KEYS.ITEM_DATES_PREFIX, KEYS.POSTERS_PREFIX,
            KEYS.COLLECTIONS_PREFIX, KEYS.COLLECTION_DATES_PREFIX, KEYS.COLLECTION_TIMESTAMPS_PREFIX, KEYS.COLLECTION_POSTERS_PREFIX
        ],
        removeGameName(appId) {
            if (!appId) return;
            const names = this.loadGameNames();
            delete names[appId];
            GM_setValue(KEYS.GAME_NAMES, JSON.stringify(names));
        },
        pruneEmptyGames() {
            const names = this.loadGameNames();
            let changed = false;
            for (const gid of Object.keys(names)) {
                let items = {}, cols = {};
                try { items = JSON.parse(GM_getValue(KEYS.ITEMS_PREFIX + gid, '{}')) || {}; } catch (e) {  }
                try { cols = JSON.parse(GM_getValue(KEYS.COLLECTIONS_PREFIX + gid, '{}')) || {}; } catch (e) {  }
                if (Object.keys(items).length === 0 && Object.keys(cols).length === 0) {
                    delete names[gid];
                    changed = true;
                    this._STORAGE_PREFIXES.forEach(p => GM_deleteValue(p + gid));
                }
            }
            if (changed) GM_setValue(KEYS.GAME_NAMES, JSON.stringify(names));
        },
        clearItems() {
            const ids = Object.keys(this.loadItems());
            GM_deleteValue(CFG._key(KEYS.ITEMS));
            GM_deleteValue(CFG._key(CFG.STORAGE_TIMESTAMPS));
            GM_deleteValue(CFG._key(KEYS.ITEM_DATES));
            GM_deleteValue(CFG._key(KEYS.ITEM_DESCS));
            this._clearPosterCache(ids);
            this._clearItemDescriptions(ids);
            this._notify();
            this.pruneEmptyGames();
        },
        clearCollections() {
            const colIds = Object.keys(this.loadCollections());
            GM_deleteValue(CFG._key(KEYS.COLLECTIONS));
            GM_deleteValue(CFG._key(KEYS.COLLECTION_DATES));
            GM_deleteValue(CFG._key(KEYS.COLLECTION_TIMESTAMPS));
            this.clearCollectionPosterCache(colIds);
            this._notify();
        },
        loadPosterCache() {
            try { return JSON.parse(GM_getValue(CFG._key(KEYS.POSTERS), '{}')); } catch (e) { return {}; }
        },
        getCachedPoster(id) {
            return this.loadPosterCache()[id] || null;
        },
        setCachedPoster(id, url) {
            const cache = this.loadPosterCache();
            cache[id] = url;
            GM_setValue(CFG._key(KEYS.POSTERS), JSON.stringify(cache));
        },
        _clearPosterCache(ids) {
            const cache = this.loadPosterCache();
            let changed = false;
            ids.forEach(id => {
                if (cache[id]) { delete cache[id]; changed = true; }
            });
            if (changed) GM_setValue(CFG._key(KEYS.POSTERS), JSON.stringify(cache));
        },
        loadItemDates() {
            try { return JSON.parse(GM_getValue(CFG._key(KEYS.ITEM_DATES), '{}')); } catch (e) { return {}; }
        },
        saveItemDate(id, dateStr) {
            const dates = this.loadItemDates();
            dates[id] = Utils.normalizeDate(dateStr);
            GM_setValue(CFG._key(KEYS.ITEM_DATES), JSON.stringify(dates));
        },
        loadItemDescriptions() {
            try { return JSON.parse(GM_getValue(CFG._key(KEYS.ITEM_DESCS), '{}')); } catch (e) { return {}; }
        },
        getItemDescription(id) {
            return this.loadItemDescriptions()[id] || '';
        },
        saveItemDescription(id, text) {
            if (!text) return;
            const descs = this.loadItemDescriptions();
            descs[id] = text;
            GM_setValue(CFG._key(KEYS.ITEM_DESCS), JSON.stringify(descs));
        },
        _clearItemDescriptions(ids) {
            const descs = this.loadItemDescriptions();
            let changed = false;
            ids.forEach(id => { if (descs[id]) { delete descs[id]; changed = true; } });
            if (changed) GM_setValue(CFG._key(KEYS.ITEM_DESCS), JSON.stringify(descs));
        },
        loadLastCheck() {
            try { return JSON.parse(GM_getValue(CFG._key(KEYS.LAST_CHECK), 'null')); } catch (e) { return null; }
        },
        saveLastCheck(time, dates) {
            GM_setValue(CFG._key(KEYS.LAST_CHECK), JSON.stringify({ time, dates: dates || {} }));
        },
        loadGameNames() {
            try { return JSON.parse(GM_getValue(KEYS.GAME_NAMES, '{}')); } catch (e) { return {}; }
        },
        saveGameName(appId, name) {
            if (!appId || !name) return;
            /* 覆盖写入：直接覆盖该游戏的显示名 */
            const names = this.loadGameNames();
            names[appId] = name;
            GM_setValue(KEYS.GAME_NAMES, JSON.stringify(names));
        },
        getCount() {
            return Object.keys(this.loadItems()).length;
        },
        hasItem(id) {
            return Object.prototype.hasOwnProperty.call(this.loadItems(), id);
        },
        loadCollections() {
            const raw = GM_getValue(CFG._key(KEYS.COLLECTIONS), '{}');
            try {
                const obj = JSON.parse(raw);
                return typeof obj === 'object' && obj !== null && !Array.isArray(obj) ? obj : {};
            } catch (e) {
                return {};
            }
        },
        saveCollections(cols) {
            clearTimeout(this._saveTimer);
            this._saveTimer = setTimeout(() => {
                GM_setValue(CFG._key(KEYS.COLLECTIONS), JSON.stringify(cols));
                this._notify();
            }, CFG.DEBOUNCE_SAVE);
        },
        saveCollectionsSync(cols) {
            GM_setValue(CFG._key(KEYS.COLLECTIONS), JSON.stringify(cols));
            this._notify();
        },
        addCollectionsSync(newCols) {
            const cols = this.loadCollections();
            const stamps = this.loadCollectionTimestamps();
            const now = Date.now();
            let added = 0;
            const newIds = [];
            for (const [id, name] of Object.entries(newCols)) {
                if (!Object.prototype.hasOwnProperty.call(cols, id)) {
                    cols[id] = name || '未知合集';
                    stamps[id] = now;
                    newIds.push(id);
                    added++;
                }
            }
            if (added > 0) {
                this.saveCollectionsSync(cols);
                this.saveCollectionTimestamps(stamps);
                const gameName = PageDetector.getGameName();
                if (gameName) this.saveGameName(PageDetector.getAppId(), gameName);
                newIds.forEach(id => ModFetcher.fetchCollectionDetails(id));
            }
            return added;
        },
        removeCollections(ids) {
            const cols = this.loadCollections();
            const stamps = this.loadCollectionTimestamps();
            const dates = this.loadCollectionDates();
            let removed = 0;
            ids.forEach(id => {
                if (Object.prototype.hasOwnProperty.call(cols, id)) {
                    delete cols[id];
                    removed++;
                }
                if (Object.prototype.hasOwnProperty.call(stamps, id)) delete stamps[id];
                if (Object.prototype.hasOwnProperty.call(dates, id)) delete dates[id];
            });
            if (removed > 0) {
                this.saveCollectionsSync(cols);
                this.saveCollectionTimestamps(stamps);
                this.saveCollectionDates(dates);
                this.clearCollectionPosterCache(ids);
                if (Object.keys(this.loadCollections()).length === 0) {
                    this.removeGameName(CFG._appId);
                }
            }
            return removed;
        },
        hasCollection(id) {
            return Object.prototype.hasOwnProperty.call(this.loadCollections(), id);
        },
        getCollectionCount() {
            return Object.keys(this.loadCollections()).length;
        },
        loadCollectionDates() {
            try { return JSON.parse(GM_getValue(CFG._key(KEYS.COLLECTION_DATES), '{}')); } catch (e) { return {}; }
        },
        saveCollectionDate(id, dateStr) {
            const dates = this.loadCollectionDates();
            dates[id] = Utils.normalizeDate(dateStr);
            GM_setValue(CFG._key(KEYS.COLLECTION_DATES), JSON.stringify(dates));
        },
        saveCollectionDates(obj) {
            const norm = {};
            for (const [k, v] of Object.entries(obj || {})) norm[k] = Utils.normalizeDate(v);
            GM_setValue(CFG._key(KEYS.COLLECTION_DATES), JSON.stringify(norm));
        },
        loadCollectionTimestamps() {
            try { return JSON.parse(GM_getValue(CFG._key(KEYS.COLLECTION_TIMESTAMPS), '{}')); } catch (e) { return {}; }
        },
        saveCollectionTimestamps(ts) {
            GM_setValue(CFG._key(KEYS.COLLECTION_TIMESTAMPS), JSON.stringify(ts));
        },
        /* 合集封面缓存 */
        loadCachedCollectionPosters() {
            try { return JSON.parse(GM_getValue(CFG._key(KEYS.COLLECTION_POSTERS), '{}')); } catch (e) { return {}; }
        },
        getCachedCollectionPoster(id) {
            return this.loadCachedCollectionPosters()[id] || null;
        },
        setCachedCollectionPoster(id, url) {
            const cache = this.loadCachedCollectionPosters();
            cache[id] = url;
            GM_setValue(CFG._key(KEYS.COLLECTION_POSTERS), JSON.stringify(cache));
        },
        saveCachedCollectionPosters(cache) {
            GM_setValue(CFG._key(KEYS.COLLECTION_POSTERS), JSON.stringify(cache));
        },
        clearCollectionPosterCache(ids) {
            const cache = this.loadCachedCollectionPosters();
            let changed = false;
            ids.forEach(id => { if (cache[id]) { delete cache[id]; changed = true; } });
            if (changed) GM_setValue(CFG._key(KEYS.COLLECTION_POSTERS), JSON.stringify(cache));
        },
        clearCollectState() {
            GM_deleteValue(CFG.STORAGE_COLLECTING);
            GM_deleteValue(CFG.STORAGE_PAGE);
            GM_deleteValue(CFG.STORAGE_TOTAL_PAGES);
            GM_deleteValue(CFG.STORAGE_TOTAL_ITEMS);
            GM_deleteValue(CFG.STORAGE_LAST_PAGE);
        },
        getCollectState() {
            return {
                isCollecting: GM_getValue(CFG.STORAGE_COLLECTING, false),
                currentPage: GM_getValue(CFG.STORAGE_PAGE, 1),
                totalPages: GM_getValue(CFG.STORAGE_TOTAL_PAGES, 1),
                totalItems: GM_getValue(CFG.STORAGE_TOTAL_ITEMS, 0),
                lastPage: GM_getValue(CFG.STORAGE_LAST_PAGE, 1)
            };
        },
        setCollectState(state) {
            if (state.isCollecting !== undefined) GM_setValue(CFG.STORAGE_COLLECTING, state.isCollecting);
            if (state.currentPage !== undefined) GM_setValue(CFG.STORAGE_PAGE, state.currentPage);
            if (state.totalPages !== undefined) GM_setValue(CFG.STORAGE_TOTAL_PAGES, state.totalPages);
            if (state.totalItems !== undefined) GM_setValue(CFG.STORAGE_TOTAL_ITEMS, state.totalItems);
            if (state.lastPage !== undefined) GM_setValue(CFG.STORAGE_LAST_PAGE, state.lastPage);
        }
    };
    /* 分区 8 · 数据提取：从各类页面提取模组/合集的 链接 / ID / 名称 / 海报图 / 发布时间 / 更新时间 / 分页信息与每页数量，并在点击收藏按钮时写入存储 */
    const Extractors = {
        extractItemDetail() {
            const id = PageDetector.getItemId();
            if (!id) return null;
            const name = (document.querySelector(SEL.WORKSHOP_ITEM_TITLE) || {}).textContent?.trim() || '未知模组';
            const poster = this._itemPoster();
            const { publishedAt, updatedAt } = this._detailDates();
            return { id, name, poster, publishedAt, updatedAt };
        },
        _itemPoster() {
            const main = document.querySelector('#previewImageMain') || document.querySelector('.workshopItemPreviewImageMain img');
            if (main && main.src) return main.src.replace(/&amp;/g, '&');
            const first = document.querySelector('#highlight_player_area img') || document.querySelector('.workshopItemPreviewImageEnlargeable');
            if (first && first.src) return first.src.replace(/&amp;/g, '&');
            return '';
        },
        extractCollectionDetail() {
            const id = PageDetector.getItemId();
            if (!id) return null;
            const name = (document.querySelector(SEL.WORKSHOP_ITEM_TITLE) || {}).textContent?.trim() || '未知合集';
            const bg = document.querySelector('#CollectionBackgroundImage') || document.querySelector('.collectionBackgroundImage');
            const poster = bg && bg.src ? bg.src.replace(/&amp;/g, '&') : '';
            const { publishedAt, updatedAt } = this._detailDates();
            return { id, name, poster, publishedAt, updatedAt };
        },
        _detailDates() {
            const left = [...document.querySelectorAll('.detailsStatLeft')].map(e => e.textContent.trim());
            const right = [...document.querySelectorAll('.detailsStatRight')].map(e => e.textContent.trim());
            const pubIdx = left.findIndex(t => t.includes('发表于'));
            const updIdx = left.findIndex(t => t.includes('更新日期'));
            return {
                publishedAt: pubIdx >= 0 ? (right[pubIdx] || '') : '',
                updatedAt: updIdx >= 0 ? (right[updIdx] || '') : ''
            };
        },
        extractBrowseCards() {
            const cards = [];
            document.querySelectorAll(SEL.FILE_DETAILS_LINK).forEach(link => {
                if (link.closest('.ws3-modal, [data-table-body], .ws3-panel')) return;
                const id = (link.href.match(/[?&]id=(\d+)/) || [])[1];
                if (!id || cards.some(c => c.id === id)) return;
                const img = link.querySelector('img') || (link.closest('[class*="aspectratio"], ._68RUj0Pwr4Q-') || link).querySelector('img');
                const poster = img && img.src ? img.src.replace(/&amp;/g, '&') : '';
                const name = (img && img.alt && img.alt.trim().length > 1 ? img.alt.trim() : (link.textContent.trim() || '未知名称'));
                cards.push({ id, name, poster });
            });
            return cards;
        },
        captureItemToStore(id) {
            let d = this.extractItemDetail();
            if (!d || d.id !== id) {
                const card = this._findCardById(id);
                if (card) {
                    d = { id: card.id, name: card.name, poster: card.poster, publishedAt: '', updatedAt: card.updatedAt || '' };
                }
            }
            if (!d || d.id !== id) return false;
            const hc = HoverCardExtractor.get(id);
            if (hc) {
                if (!d.name || d.name === '未知名称') d.name = hc.name || d.name;
                if (!d.updatedAt && hc.updatedAt) d.updatedAt = hc.updatedAt;
                if (!d.publishedAt && hc.publishedAt) d.publishedAt = hc.publishedAt;
            }
            /* 覆盖写入：只要拿到新值就归一化后直接覆盖对应字段，不再因"看起来相等"而跳过（避免旧格式残留） */
            let changed = false;
            if (d.name) {
                const items = Store.loadItems();
                items[id] = d.name;
                Store.saveItemsSync(items);
                changed = true;
            }
            if (d.poster) { Store.setCachedPoster(id, d.poster); changed = true; }
            const dateStr = Utils.normalizeDate(d.updatedAt || d.publishedAt);
            if (dateStr) { Store.saveItemDate(id, dateStr); changed = true; }
            return changed;
        },
        captureCollectionToStore(id) {
            const d = this.extractCollectionDetail();
            if (!d || d.id !== id) return false;
            /* 覆盖写入：同 captureItemToStore */
            let changed = false;
            if (d.name) {
                const cols = Store.loadCollections();
                cols[id] = d.name;
                Store.saveCollectionsSync(cols);
                changed = true;
            }
            if (d.poster) { Store.setCachedCollectionPoster(id, d.poster); changed = true; }
            const dateStr = Utils.normalizeDate(d.updatedAt || d.publishedAt);
            if (dateStr) { Store.saveCollectionDate(id, dateStr); changed = true; }
            return changed;
        },
        /* —— 兼容旧调用 —— */
        getSingleItemId() {
            return PageDetector.getItemId();
        },
        getSingleItemTitle() {
            const t = document.querySelector(SEL.WORKSHOP_ITEM_TITLE);
            return t ? t.textContent.trim() : '未知模组';
        },
        getItemName(el) {
            if (!el) return '未知名称';
            const selectors = [
                SEL.WORKSHOP_ITEM_TITLE, '.workshop_item_name', '.itemTitle',
                '.workshop_item_title', '.sharedfile_item_title', '.workshopItemPreviewTitle'
            ];
            for (const sel of selectors) {
                const titleEl = el.querySelector(sel);
                if (titleEl && titleEl.textContent.trim()) return titleEl.textContent.trim();
            }
            const parent = el.parentElement ? el.parentElement.closest('.workshopItem, .workshopItemSubscription, .collectionItem, [id^="sharedfile_"]') : null;
            if (parent) {
                for (const sel of selectors) {
                    const titleEl = parent.querySelector(sel);
                    if (titleEl && titleEl.textContent.trim()) return titleEl.textContent.trim();
                }
            }
            if (el.title && el.title.trim()) return el.title.trim();
            const link = el.querySelector('a[href*="filedetails"]');
            if (link && link.textContent.trim()) return link.textContent.trim();
            return '未知名称';
        },
        extractWorkshopItemEntries() {
            const entries = {};
            this.extractWorkshopCards().forEach(c => {
                if (c.id) entries[c.id] = c.name || '未知名称';
            });
            return entries;
        },
        extractWorkshopCards() {
            const cards = [];
            document.querySelectorAll(SEL.WORKSHOP_ITEM).forEach(el => {
                const card = this._parseWorkshopCard(el);
                if (card && card.id && !cards.some(c => c.id === card.id)) cards.push(card);
            });
            return cards;
        },
        _findCardById(id) {
            let found = null;
            document.querySelectorAll(SEL.WORKSHOP_ITEM).forEach(el => {
                if (found) return;
                const card = this._parseWorkshopCard(el);
                if (card && card.id === id) found = card;
            });
            return found;
        },
        _parseWorkshopCard(el) {
            if (!el) return null;
            const linkEl = el.querySelector('a.ugc') ||
                el.querySelector(SEL.FILE_DETAILS_LINK) ||
                el.closest(SEL.FILE_DETAILS_LINK);
            let id = (linkEl && linkEl.dataset && linkEl.dataset.publishedfileid) ||
                (linkEl && linkEl.href && (linkEl.href.match(/[?&]id=(\d+)/) || [])[1]) ||
                (el.getAttribute && el.getAttribute('data-publishedfileid')) || null;
            if (!id) {
                const idMatch = el.id ? el.id.match(/(\d+)$/) : null;
                if (idMatch) id = idMatch[1];
            }
            if (!id) return null;
            const name = (el.querySelector(SEL.WORKSHOP_ITEM_TITLE) || {}).textContent?.trim() || '未知名称';
            const img = el.querySelector('img.workshopItemPreviewImage') || el.querySelector('img');
            const poster = img && img.src ? img.src.replace(/&amp;/g, '&') : '';
            const link = linkEl && linkEl.href ? linkEl.href : '';
            const appEl = el.querySelector('a[data-appid]') || el.querySelector('a.ugc');
            const appid = (appEl && appEl.dataset && appEl.dataset.appid) ||
                (link && (link.match(/[?&]appid=(\d+)/) || [])[1]) ||
                PageDetector.getAppId() || null;
            const gameName = (el.querySelector(SEL.WORKSHOP_ITEM_APP) || {}).textContent?.trim() || '';
            // 卡片可能同时含「订阅时间」与「最后更新时间」两个 .workshopItemDate，
            // 仅取标签为「最后更新时间 / Last updated」的那个，并去除空格后作为更新时间
            let updatedAt = '';
            el.querySelectorAll('.workshopItemDate').forEach(dateEl => {
                const dateText = dateEl.textContent.trim();
                const m = dateText.match(/(?:最后更新时间|Last updated)\s*(.+)$/i);
                if (m) updatedAt = m[1].replace(/\s+/g, '');
            });
            return { id, name, poster, link, appid, gameName, updatedAt };
        },
        extractCollectionItems() {
            const items = {};
            document.querySelectorAll('[id^="sharedfile_"]').forEach(el => {
                const idMatch = el.id.match(/^sharedfile_(\d+)$/);
                if (idMatch) items[idMatch[1]] = this.getItemName(el);
            });
            if (Object.keys(items).length === 0) {
                document.querySelectorAll('[onclick*="SubscribeCollectionItem"]').forEach(el => {
                    const onclick = el.getAttribute('onclick') || '';
                    const match = onclick.match(/SubscribeCollectionItem\s*\(\s*'(\d+)'/);
                    if (match) items[match[1]] = '未知名称';
                });
            }
            return items;
        },
        getPaginationInfo() {
            let totalItems = 0, currentPage = 1, totalPages = 1;
            const infoText = document.querySelector('.workshopBrowsePagingInfo');
            if (infoText) {
                const match = infoText.textContent.match(/共\s*(\d+)\s*项/);
                if (match) totalItems = parseInt(match[1]);
            }
            const currentElem = document.querySelector('.page_current');
            if (currentElem) currentPage = parseInt(currentElem.textContent);
            const pagination = document.querySelector('.workshopBrowsePagingControls');
            if (pagination) {
                pagination.querySelectorAll('.pagelink').forEach(link => {
                    const p = parseInt(link.textContent);
                    if (!isNaN(p) && p > totalPages) totalPages = p;
                });
                if (currentPage > totalPages) totalPages = currentPage;
            }
            return { totalItems, currentPage, totalPages };
        },
        ensurePerPage() {
            const hasMultiPage = document.querySelector('a[href*="p=2"], a[href*="&p=2"], .workshopPagination, .paginationBlock, [class*="pagination"]');
            if (!hasMultiPage) return true;
            const url = new URL(window.location.href);
            const current = url.searchParams.get('numperpage');
            if (current !== String(CFG.TARGET_PER_PAGE)) {
                url.searchParams.set('numperpage', String(CFG.TARGET_PER_PAGE));
                url.searchParams.set('p', '1');
                window.location.href = url.toString();
                return false;
            }
            return true;
        },
        gotoPage(pageNum) {
            const url = new URL(window.location.href);
            url.searchParams.set('p', String(pageNum));
            window.location.href = url.toString();
        }
    };
    /* 分区 9 · 悬浮卡片提取：监听 Steam 原生悬浮卡片，提取模组/合集名称、发布时间、更新时间并缓存（仅点击收藏按钮时才写入存储） */
    const HoverCardExtractor = {
        _cache: new Map(),
        _observer: null,
        _initialized: false,
        _MAX_CACHE: 500,
        init() {
            if (this._initialized) return;
            this._initialized = true;
            this._startObserver();
        },
        get(id) {
            return this._cache.get(id) || null;
        },
        _trimCache() {
            if (this._cache.size <= this._MAX_CACHE) return;
            const keys = [...this._cache.keys()];
            keys.slice(0, keys.length - this._MAX_CACHE).forEach(k => this._cache.delete(k));
        },
        _startObserver() {
            this._observer = new MutationObserver((mutations) => {
                for (const m of mutations) {
                    for (const node of m.addedNodes) {
                        if (node.nodeType !== 1) continue;
                        const card = this._findHoverCard(node);
                        if (card) this._cacheData(card);
                    }
                }
            });
            this._observer.observe(document.body, { childList: true, subtree: true });
        },
        _findHoverCard(node) {
            if (!node || node.nodeType !== 1) return null;
            const text = node.textContent || '';
            if ((text.includes('发布时间') || text.includes('更新时间')) &&
                node.querySelector && node.querySelector(SEL.FILE_DETAILS_LINK)) {
                return node;
            }
            if (node.matches && (node.getAttribute('popover') === 'manual')) {
                if (text.includes('发布时间') || text.includes('更新时间')) return node;
            }
            if (!node.querySelectorAll) return null;
            const candidates = node.querySelectorAll('div');
            for (const c of candidates) {
                const t = c.textContent || '';
                if ((t.includes('发布时间') || t.includes('更新时间')) && t.length < 5000 &&
                    c.querySelector(SEL.FILE_DETAILS_LINK)) {
                    return c;
                }
            }
            return null;
        },
        _cacheData(card) {
            const data = this._extract(card);
            if (!data || !data.id) return;
            const prev = this._cache.get(data.id) || {};
            this._cache.set(data.id, { ...prev, ...data, _ts: Date.now() });
            this._trimCache();
        },
        _extract(card) {
            const result = { id: null, name: '', publishedAt: '', updatedAt: '' };
            const link = card.querySelector(SEL.FILE_DETAILS_LINK);
            if (link) {
                result.id = (link.href.match(/[?&]id=(\d+)/) || [])[1] || null;
                if (!result.name) result.name = (link.textContent || '').trim();
            }
            if (!result.name) {
                const titleEl = card.querySelector('.BgRIiTNqRTE-');
                if (titleEl) result.name = titleEl.textContent.trim();
            }
            if (!result.name) {
                const t = (card.querySelector(SEL.WORKSHOP_ITEM_TITLE) || {}).textContent;
                if (t) result.name = t.trim();
            }
            const text = card.textContent || '';
            const pub = text.match(/发布时间[:：]\s*([^\n]{0,40})/);
            if (pub) result.publishedAt = pub[1].trim();
            const upd = text.match(/更新时间[:：]\s*([^\n]{0,40})/);
            if (upd) result.updatedAt = upd[1].trim();
            if (!result.id && !result.name) return null;
            return result;
        },
        commitToItems(id) {
            const d = this._cache.get(id);
            if (!d) return false;
            /* 覆盖写入：只要悬浮卡片有新值就直接覆盖（名称/日期均归一化后写入） */
            let changed = false;
            if (d.name && d.name.length > 1) {
                const items = Store.loadItems();
                items[id] = d.name;
                Store.saveItemsSync(items);
                changed = true;
            }
            const dateStr = d.updatedAt || d.publishedAt;
            if (dateStr) { Store.saveItemDate(id, dateStr); changed = true; }
            return changed;
        }
    };
    /* 分区 10 · 模组数据获取：仅在收藏管理面板打开时生效，通过 Steam 接口异步获取模组海报与更新时间，串行限流避免触发风控 */
    const ModFetcher = {
        _active: false,
        _queue: [],
        _running: 0,
        _maxConcurrent: 2,
        _minInterval: 400,
        _lastReq: 0,
        _throttleUntil: 0,
        setActive(v) {
            this._active = !!v;
            if (this._active) this._pump();
        },
        isActive() { return this._active; },
        fetchDetails(id, opts = {}) {
            return new Promise((resolve) => {
                if (!id) { resolve({ poster: '', date: '', failed: false }); return; }
                const cached = Store.getCachedPoster(id);
                const date = Store.loadItemDates()[id];
                if (!opts.forceRefresh && cached && date) { resolve({ poster: cached, date, failed: false }); return; }
                if (!this._active) { resolve({ poster: cached || '', date: date || '', failed: false }); return; }
                this._enqueue({ id, resolve, retry: 0, collection: false });
            });
        },
        fetchCollectionDetails(id) {
            return new Promise((resolve) => {
                if (!id) { resolve({ date: '', failed: true }); return; }
                const date = Store.loadCollectionDates()[id];
                if (date) { resolve({ date, failed: false }); return; }
                if (!this._active) { resolve({ date: date || '', failed: false }); return; }
                this._enqueue({ id, resolve, retry: 0, collection: true });
            });
        },
        _enqueue(task) {
            this._queue.push(task);
            this._pump();
        },
        _pump() {
            if (!this._active) return;
            while (this._running < this._maxConcurrent && this._queue.length > 0) {
                const task = this._queue.shift();
                this._running++;
                this._run(task);
            }
        },
        _run(task) {
            const now = Date.now();
            const wait = Math.max(0, this._minInterval - (now - this._lastReq), this._throttleUntil - now);
            setTimeout(() => this._exec(task), wait);
        },
        _exec(task) {
            this._lastReq = Date.now();
            const body = 'itemcount=1&publishedfileids[0]=' + encodeURIComponent(task.id);
            fetch('https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body
            })
                .then((r) => {
                    if (r.status === 429) { this._on429(task, r); return null; }
                    return r.ok ? r.json() : null;
                })
                .then((data) => {
                    if (data === null) return;
                    const pf = data && data.response && data.response.publishedfiledetails && data.response.publishedfiledetails[0];
                    if (pf && pf.preview_url) {
                        const poster = pf.preview_url.replace(/&amp;/g, '&');
                        const ts = pf.time_updated || pf.time_created;
                        const date = ts ? this._fmtDate(Number(ts)) : '';
                        if (task.collection) {
                            if (date) Store.saveCollectionDate(task.id, date);
                            task.resolve({ date, failed: false });
                        } else {
                            Store.setCachedPoster(task.id, poster);
                            if (date) Store.saveItemDate(task.id, date);
                            task.resolve({ poster, date, failed: false });
                        }
                        this._finish(task);
                        return;
                    }
                    this._legacyFetch(task);
                })
                .catch(() => this._legacyFetch(task));
        },
        _on429(task, resp) {
            const ra = parseInt((resp && resp.headers && resp.headers.get ? resp.headers.get('retry-after') : '') || '', 10);
            const delay = (ra > 0 ? ra * 1000 : Math.min(30000, (task.retry + 1) * 2000 + Math.floor(Math.random() * 500)));
            this._throttleUntil = Date.now() + delay;
            if (task.retry < 5) {
                task.retry++;
                this._enqueue(task);
            } else {
                const cur = task.collection ? Store.loadCollectionDates()[task.id] : Store.loadItemDates()[task.id];
                task.resolve({ poster: '', date: cur || '', failed: true });
                this._finish(task);
            }
        },
        _legacyFetch(task) {
            const { id, resolve, collection } = task;
            const appId = PageDetector.getAppId();
            const url = `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}${appId ? '&appid=' + appId : ''}`;
            fetch(url)
                .then(r => r.ok ? r.text() : null)
                .then((html) => {
                    if (!html) { resolve({ poster: '', date: '', failed: true }); this._finish(task); return; }
                    const res = this._parse(id, html);
                    if (collection) {
                        if (res.date) Store.saveCollectionDate(id, res.date);
                        resolve({ date: res.date, failed: !res.date });
                    } else {
                        resolve({ poster: res.poster || '', date: res.date, failed: !(res.poster || res.date) });
                    }
                    this._finish(task);
                })
                .catch(() => { resolve({ poster: '', date: '', failed: true }); this._finish(task); });
        },
        _finish(task) {
            this._running--;
            this._pump();
        },
        _fmtDate(ts) {
            if (!ts) return '';
            const d = new Date(ts * 1000);
            if (isNaN(d.getTime())) return '';
            const pad = n => String(n).padStart(2, '0');
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        },
        _parse(id, html) {
            let imgUrl = null;
            let m = html.match(/<img[^>]*\bid\s*=\s*["']enlarged_image_carousel["'][^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/i);
            if (m) imgUrl = m[1];
            if (!imgUrl) {
                m = html.match(/<meta[^>]+(?:property|name)\s*=\s*["']og:image["'][^>]*content\s*=\s*["']([^"']+)["']/i)
                  || html.match(/<meta[^>]*content\s*=\s*["']([^"']+)["'][^>]+(?:property|name)\s*=\s*["']og:image["']/i);
                if (m) imgUrl = m[1];
            }
            if (!imgUrl) {
                const re = /https:\/\/(?:images\.steamusercontent\.com\/ugc\/|shared\.cloudflare\.steamstatic\.com\/|shared\.akamai\.steamstatic\.com\/|steamcdn-a\.akamaihd\.net\/)[^\s"'<>]+/gi;
                const urls = [...html.matchAll(re)].map((x) => x[0]);
                imgUrl = urls[0] || null;
            }
            if (!imgUrl) {
                const jsonM = html.match(/"preview_url"\s*:\s*"([^"\\]+)"/);
                if (jsonM) imgUrl = jsonM[1];
            }
            if (imgUrl) {
                imgUrl = imgUrl.replace(/&amp;/g, '&');
                Store.setCachedPoster(id, imgUrl);
            }
            const labels = [...html.matchAll(/<div class="detailsStatLeft">([^<]*)<\/div>/g)].map((x) => x[1]);
            const values = [...html.matchAll(/<div class="detailsStatRight">([^<]*)<\/div>/g)].map((x) => x[1]);
            const updateIdx = labels.indexOf('更新日期');
            const pubIdx = labels.indexOf('发表于');
            const dateStr = ((updateIdx >= 0 ? values[updateIdx] : '') || (pubIdx >= 0 ? values[pubIdx] : '') || '')
                .replace(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日.*/, '$1年$2月$3日')
                .replace(/(\d{1,2})\s*月\s*(\d{1,2})\s*日.*/, '$1月$2日');
            if (dateStr) Store.saveItemDate(id, dateStr);
            return { poster: imgUrl, date: dateStr };
        }
    };
    /* 分区 11 · 浮层面板容器：可拖拽、可最小化的浮层容器，提供日志、进度与按钮状态管理 */
    const Panel = {
        _instances: [],
        create(config) {
            const {
                title,
                icon = '📦',
                contentFn,
                onInit,
                extraHeaderBtns = []
            } = config;
            const panel = document.createElement('div');
            panel.className = 'ws3-panel';
            const headerBtnsHtml = extraHeaderBtns.map(b =>
                `<button class="ws3-panel-btn ${b.cls || ''}" title="${b.title || ''}" data-panel-action="${b.action}">${b.icon}</button>`
            ).join('');
            panel.innerHTML = `
                <div class="ws3-panel-header" data-panel-drag>
                    <div class="ws3-panel-title">
                        <span class="ws3-panel-title-icon">${icon}</span>
                        <span>${title}</span>
                    </div>
                    <div class="ws3-panel-controls">
                        ${headerBtnsHtml}
                        <button class="ws3-panel-btn ws3-minimize-btn" data-panel-action="minimize" title="最小化">─</button>
                        <button class="ws3-panel-btn" data-panel-action="close" title="关闭">✕</button>
                    </div>
                </div>
                <div class="ws3-panel-body"></div>
            `;
            document.documentElement.appendChild(panel);
            const body = panel.querySelector('.ws3-panel-body');
            const header = panel.querySelector('.ws3-panel-header');
            if (contentFn) {
                const content = contentFn(panel);
                if (typeof content === 'string') {
                    body.innerHTML = content;
                } else if (content instanceof HTMLElement) {
                    body.appendChild(content);
                }
            }
            panel.addEventListener('click', (e) => {
                const btn = e.target.closest('[data-panel-action]');
                if (!btn) return;
                const action = btn.dataset.panelAction;
                switch (action) {
                    case 'close':
                        panel.style.display = 'none';
                        if (panel._removeResize) panel._removeResize();
                        if (panel._removeDragListeners) panel._removeDragListeners();
                        break;
                    case 'minimize':
                        const minimized = panel.classList.toggle('ws3-minimized');
                        btn.textContent = minimized ? '□' : '─';
                        btn.title = minimized ? '展开' : '最小化';
                        if (!minimized) this._resetPosition(panel, config);
                        break;
                }
                if (action !== 'close' && action !== 'minimize') {
                    panel.dispatchEvent(new CustomEvent('panel-action', { detail: { action }, bubbles: true }));
                }
            });
            this._resetPosition(panel, config);
            this._setupDrag(panel, header);
            const onResize = Utils.debounce(() => {
                if (panel.style.display === 'none') return;
                this._resetPosition(panel, config);
            }, 100);
            window.addEventListener('resize', onResize);
            panel._removeResize = () => window.removeEventListener('resize', onResize);
            this._instances.push(panel);
            if (onInit) {
                setTimeout(() => onInit(panel), 100);
            }
            return panel;
        },
        _resetPosition(panel, config) {
            panel.style.top = '';
            panel.style.left = '';
            if (config.position === 'bottom-left') {
                panel.style.left = '0';
                panel.style.bottom = '0';
            } else {
                panel.style.bottom = '0';
                panel.style.right = '0';
            }
        },
        _setupDrag(panel, handle) {
            let isDragging = false;
            let startX, startY, initLeft, initTop;
            handle.addEventListener('mousedown', (e) => {
                if (e.target.closest('[data-panel-action]')) return;
                isDragging = true;
                startX = e.clientX;
                startY = e.clientY;
                const rect = panel.getBoundingClientRect();
                initLeft = rect.left;
                initTop = rect.top;
                panel.style.right = 'auto';
                panel.style.bottom = 'auto';
                panel.style.left = initLeft + 'px';
                panel.style.top = initTop + 'px';
                handle.style.cursor = 'grabbing';
                e.preventDefault();
            });
            const onMove = (e) => {
                if (!isDragging) return;
                let newLeft = initLeft + e.clientX - startX;
                let newTop = initTop + e.clientY - startY;
                newLeft = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, newLeft));
                newTop = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, newTop));
                panel.style.left = newLeft + 'px';
                panel.style.top = newTop + 'px';
            };
            const onUp = () => {
                if (!isDragging) return;
                isDragging = false;
                handle.style.cursor = 'move';
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
            panel._removeDragListeners = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            };
            const cleanupObserver = new MutationObserver(() => {
                if (!document.documentElement.contains(panel)) {
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                    cleanupObserver.disconnect();
                }
            });
            cleanupObserver.observe(document.documentElement, { childList: true });
        },
        log(panel, message, type = 'info') {
            const logEl = panel.querySelector('.ws3-panel-log');
            if (!logEl) return;
            const entry = document.createElement('div');
            entry.className = `ws3-log-${type}`;
            entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
            logEl.appendChild(entry);
            logEl.scrollTop = logEl.scrollHeight;
            while (logEl.children.length > 50) logEl.firstChild.remove();
        },
        updateProgress(panel, collected, total, page, totalPages) {
            const fill = panel.querySelector('.ws3-panel-progress-fill');
            if (fill && total > 0) fill.style.width = `${Math.min(100, (collected / total) * 100)}%`;
            const text = panel.querySelector('[data-progress-text]');
            if (text) {
                if (page && totalPages) {
                    text.textContent = `第 ${page}/${totalPages} 页 | 已收集: ${collected}/${total}`;
                } else {
                    text.textContent = `已收集: ${collected}/${total}`;
                }
            }
        },
        setButtonDisabled(panel, selector, disabled) {
            const btn = panel.querySelector(selector);
            if (btn) btn.disabled = disabled;
        }
    };
    /* 分区 12 · 列表管理器：已收集模组的列表管理器（搜索 / 排序 / 分页 / 批量导出 / 海报预览） */
    const ListManager = {
        _currentView: 'mod',
        _currentSort: 'none',
        _currentDir: 'desc',
        _checking: false,
        _searchQuery: '',
        show(view) {
            const detected = PageDetector.getAppId() || CFG._appId || '0';
            CFG.setApp(detected);
            ModFetcher.setActive(true);
            this._cachedItems = Store.loadItems();
            this._cachedStamps = Store.loadTimestamps();
            this._cachedDates = Store.loadItemDates();
            this._cachedCollections = Store.loadCollections();
            this._cachedColStamps = Store.loadCollectionTimestamps();
            this._cachedColDates = Store.loadCollectionDates();
            if (Object.keys(this._cachedItems).length === 0 && Object.keys(this._cachedCollections).length === 0) {
                Toast.warning('收藏夹为空，请先收藏模组或合集');
            }
            if (view === undefined) {
                const pt = PageDetector.getType();
                if (pt === 'collection' || pt === 'collectionBrowse') view = 'collection';
            }
            this._currentView = (view === 'collection' && Object.keys(this._cachedCollections).length > 0) ? 'collection' : 'mod';
            this._currentSort = 'none';
            this._previewEnabled = GM_getValue(KEYS.PREVIEW_ENABLED, true);
            this._currentDir = 'desc';
            this._searchQuery = '';
            this._filter = 'all';
            this._pageSize = 50;
            this._currentPage = 1;
            this._render();
        },
        /* 重新从存储加载所有缓存数据（写库操作后必须调用，否则表格走旧缓存不刷新） */
        _reloadCache() {
            this._cachedItems = Store.loadItems();
            this._cachedStamps = Store.loadTimestamps();
            this._cachedDates = Store.loadItemDates();
            this._cachedCollections = Store.loadCollections();
            this._cachedColStamps = Store.loadCollectionTimestamps();
            this._cachedColDates = Store.loadCollectionDates();
        },
        _render() {
            const existing = document.querySelector('.ws3-modal-backdrop');
            if (existing) existing.remove();
            const backdrop = document.createElement('div');
            backdrop.className = 'ws3-modal-backdrop';
            const modal = document.createElement('div');
            modal.className = 'ws3-modal';
            modal.innerHTML = this._buildHtml();
            backdrop.appendChild(modal);
            document.documentElement.appendChild(backdrop);
            const closeModal = () => {
                ModFetcher.setActive(false); 
                if (this._storeUnsub) { this._storeUnsub(); this._storeUnsub = null; }
                this._modal = null;
                backdrop.style.opacity = '0';
                backdrop.style.transition = 'opacity 0.2s';
                setTimeout(() => backdrop.remove(), 200);
            };
            modal.querySelector('.ws3-modal-close').onclick = closeModal;
            this._refreshTable(modal);
            this._bindEvents(modal, closeModal);
            this._modal = modal;
            this._storeUnsub = Store.onChange(Utils.debounce(() => {
                if (!this._modal || !document.documentElement.contains(this._modal)) return;
                this._reloadCache();
                this._refreshTable(this._modal);
            }, 150));
            const onKeyDown = (e) => {
                if (!document.body.contains(backdrop)) {
                    document.removeEventListener('keydown', onKeyDown);
                    return;
                }
                if (e.key === 'Escape') closeModal();
                if (e.ctrlKey && e.key === 'a') {
                    e.preventDefault();
                    modal.querySelectorAll(SEL.ITEM_CHECKBOX).forEach(cb => { cb.checked = true; });
                    this._updateSelection(modal);
                }
            };
            document.addEventListener('keydown', onKeyDown);
        },
        _buildHtml() {
            return `
                <div class="ws3-modal-header">
                    <div class="ws3-modal-title">
                        <span>📋</span>
                        <span>收藏管理器</span>
                        <select class="ws3-game-select" data-game-select style="margin-left:10px;font-size:11px;padding:2px 6px;background:var(--ws3-bg-secondary);color:var(--ws3-text-primary);border:1px solid var(--ws3-border);border-radius:4px;" disabled></select>
                        <div class="ws3-type-toggle" data-type-toggle>
                            <button class="ws3-type-btn ${this._currentView === 'mod' ? 'is-active' : ''}" data-view="mod" title="查看收藏的模组">🎮 模组</button>
                            <button class="ws3-type-btn ${this._currentView === 'collection' ? 'is-active' : ''}" data-view="collection" title="查看收藏的合集">📚 合集</button>
                        </div>
                        <span style="font-size:12px;color:var(--ws3-text-muted);font-weight:400;" data-info="count"></span>
                        <span data-check-info style="font-size:10px;color:var(--ws3-text-muted);margin-left:12px;display:none;"></span>
                    </div>
                    <button class="ws3-modal-close" title="关闭 (Esc)">✕</button>
                </div>
                <div class="ws3-modal-toolbar">
                    <div class="ws3-confirm-bar" data-confirm-bar style="display:none;">
                        <span class="ws3-confirm-msg"></span>
                        <span class="ws3-confirm-actions">
                            <button class="ws3-btn ws3-btn-danger ws3-btn-sm" data-confirm-yes>确认删除</button>
                            <button class="ws3-btn ws3-btn-secondary ws3-btn-sm" data-confirm-no>取消</button>
                        </span>
                    </div>
                    <div class="ws3-toolbar-row ws3-toolbar-row-top">
                        <div class="ws3-search-wrap">
                            <span class="ws3-search-icon">🔍</span>
                            <input class="ws3-search-input" type="text" placeholder="搜索模组名称或 ID..." data-search>
                            <span class="ws3-search-clear" data-search-clear style="display:none;">×</span>
                        </div>
                        <select class="ws3-filter-select" data-filter style="font-size:11px;padding:5px 8px;background:var(--ws3-bg-tertiary);color:var(--ws3-text-primary);border:1px solid var(--ws3-border);border-radius:4px;cursor:pointer;">
                            <option value="all">📂 全部</option>
                            <option value="has-date">✅ 有更新时间</option>
                            <option value="no-date">⏳ 无更新时间</option>
                            <option value="updated">🆕 7天内更新</option>
                        </select>
                        <button class="ws3-btn ws3-btn-accent ws3-btn-sm ws3-btn-compact" data-action="check-updates" style="width:139px">🔄 检查更新</button>
                    </div>
                    <div class="ws3-toolbar-row ws3-toolbar-row-bottom">
                        <button class="ws3-btn ws3-btn-secondary ws3-btn-sm ws3-btn-compact" data-action="select-all">全选</button>
                        <button class="ws3-btn ws3-btn-secondary ws3-btn-sm ws3-btn-compact" data-action="deselect-all">取消</button>
                        <button class="ws3-btn ws3-btn-danger ws3-btn-sm ws3-btn-uniform" data-action="batch-delete">🗑 删除选中</button>
                        <button class="ws3-btn ws3-btn-accent ws3-btn-sm ws3-btn-uniform" data-action="toggle-preview">${this._previewEnabled ? '🖼 预览·开' : '🖼 预览·关'}</button>
                        <button class="ws3-btn ws3-btn-secondary ws3-btn-sm ws3-btn-uniform" data-action="open-newtab">🌐 新标签打开</button>
                        <div class="ws3-more-wrap" data-data-export-wrap>
                            <button class="ws3-btn ws3-btn-primary ws3-btn-sm ws3-btn-uniform" data-action="toggle-data-export">📦 数据导出 ▾</button>
                            <div class="ws3-more-menu" data-data-export-menu>
                                <button data-action="export-data-all">📦 导出全部游戏</button>
                                <button data-action="export-data-current">📂 导出当前游戏</button>
                            </div>
                        </div>
                        <button class="ws3-btn ws3-btn-primary ws3-btn-sm ws3-btn-uniform" data-action="import-data">📥 数据导入</button>
                    </div>
                </div>
                <div class="ws3-modal-body">
                    <table class="ws3-table">
                        <thead>
                            <tr>
                                <th class="ws3-col-check"><input type="checkbox" class="ws3-checkbox" data-select-all></th>
                                <th class="ws3-col-name ws3-sortable" data-sort="name">名称<span class="ws3-sort-arrow">↕</span></th>
                                <th class="ws3-col-id">ID</th>
                                <th class="ws3-col-date ws3-sortable" data-sort="date">更新时间<span class="ws3-sort-arrow">↕</span></th>
                                <th class="ws3-col-time ws3-sortable" data-sort="time">添加时间<span class="ws3-sort-arrow">↕</span></th>
                                <th class="ws3-col-actions">操作</th>
                            </tr>
                        </thead>
                        <tbody data-table-body></tbody>
                    </table>
                    <div class="ws3-empty-state" data-empty-state style="display:none;">
                        <div class="ws3-empty-state-icon">📭</div>
                        <div class="ws3-empty-state-text">没有找到匹配的模组</div>
                        <div class="ws3-empty-state-sub">尝试修改搜索条件</div>
                    </div>
                </div>
                <div class="ws3-modal-footer">
                    <span class="ws3-footer-info" data-footer-info>
                        <span>总计: <strong data-info="total">0</strong></span>
                        <span>已选: <strong data-info="selected" style="color:var(--ws3-accent);">0</strong></span>
                        <select class="ws3-page-size-select" data-page-size style="margin-left:4px;font-size:11px;padding:3px 6px;background:var(--ws3-bg-tertiary);color:var(--ws3-text-primary);border:1px solid var(--ws3-border);border-radius:4px;cursor:pointer;">
                            <option value="50">50条/页</option>
                            <option value="100">100条/页</option>
                            <option value="200">200条/页</option>
                            <option value="400">400条/页</option>
                            <option value="600">600条/页</option>
                            <option value="99999">全部</option>
                        </select>
                        <button class="ws3-btn ws3-btn-secondary ws3-btn-sm" data-action="prev-page" style="flex:none;margin-left:4px;">◀</button>
                        <div class="ws3-wheel-box" data-action="wheel-page" title="滚轮翻页" tabindex="0" role="button" aria-label="滚轮翻页">
                            <svg class="ws3-wheel-icon" viewBox="0 0 24 24" fill="none" stroke-width="1.6" aria-hidden="true">
                                <rect x="7" y="3" width="10" height="17" rx="5"></rect>
                                <line x1="12" y1="7" x2="12" y2="11"></line>
                            </svg>
                            <span class="ws3-wheel-tooltip">滚轮翻页</span>
                        </div>
                        <span class="ws3-page-display" data-page-display role="spinbutton" tabindex="0" aria-valuenow="1" aria-valuemin="1" aria-valuemax="1" title="点击选中后输入页码，滚轮翻页" style="user-select:none;">
                            <span class="ws3-page-digits" data-page-digits><span class="ws3-digit">1</span></span><span class="ws3-page-caret" data-page-caret></span><span class="ws3-page-total" data-info="total-pages">/ 1</span>
                        </span>
                        <button class="ws3-btn ws3-btn-secondary ws3-btn-sm" data-action="next-page" style="flex:none;">▶</button>
                    </span>
                    <span class="ws3-footer-actions">
                        <button class="ws3-btn ws3-btn-secondary ws3-btn-sm ws3-btn-uniform" data-action="copy-selected-ids">📋 复制ID</button>
                        <button class="ws3-btn ws3-btn-secondary ws3-btn-sm ws3-btn-uniform" data-action="copy-selected-cmds">⚙️ 复制CMD</button>
                        <div class="ws3-export-wrap" data-export-info-wrap>
                            <button class="ws3-btn ws3-btn-primary ws3-btn-sm ws3-btn-uniform" data-action="toggle-export-info">📤 导出 ▾</button>
                            <div class="ws3-export-menu" data-export-info-menu style="display:none;">
                                <div class="ws3-export-item" data-export-type="name"><span>导出名称<span class="ws3-export-caret">▸</span></span>
                                    <div class="ws3-export-sub">
                                        <button data-export-scope="checked">导出勾选</button>
                                        <button data-export-scope="page">导出本页</button>
                                        <button data-export-scope="all">导出全部</button>
                                    </div>
                                </div>
                                <div class="ws3-export-item" data-export-type="id"><span>导出 ID<span class="ws3-export-caret">▸</span></span>
                                    <div class="ws3-export-sub">
                                        <button data-export-scope="checked">导出勾选</button>
                                        <button data-export-scope="page">导出本页</button>
                                        <button data-export-scope="all">导出全部</button>
                                    </div>
                                </div>
                                <div class="ws3-export-item" data-export-type="cmd"><span>导出 CMD<span class="ws3-export-caret">▸</span></span>
                                    <div class="ws3-export-sub">
                                        <button data-export-scope="checked">导出勾选</button>
                                        <button data-export-scope="page">导出本页</button>
                                        <button data-export-scope="all">导出全部</button>
                                    </div>
                                </div>
                                <div class="ws3-export-item" data-export-type="link"><span>导出链接<span class="ws3-export-caret">▸</span></span>
                                    <div class="ws3-export-sub">
                                        <button data-export-scope="checked">导出勾选</button>
                                        <button data-export-scope="page">导出本页</button>
                                        <button data-export-scope="all">导出全部</button>
                                    </div>
                                </div>
                                <div class="ws3-export-item" data-export-type="all"><span>导出全部信息<span class="ws3-export-caret">▸</span></span>
                                    <div class="ws3-export-sub">
                                        <button data-export-scope="checked">导出勾选</button>
                                        <button data-export-scope="page">导出本页</button>
                                        <button data-export-scope="all">导出全部</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <button class="ws3-btn ws3-btn-danger ws3-btn-sm ws3-btn-uniform" data-action="clear-all">🗑 全部清空</button>
                    </span>
                </div>
            `;
        },
        _getFilteredData() {
            return this._currentView === 'collection'
                ? this._getFilteredCollections()
                : this._getFilteredMods();
        },
        _getFilteredMods() {
            const items = this._cachedItems || Store.loadItems();
            const stamps = this._cachedStamps || Store.loadTimestamps();
            const dates = this._cachedDates || Store.loadItemDates();
            let ids = Object.keys(items);
            if (this._searchQuery) {
                const q = this._searchQuery.toLowerCase();
                ids = ids.filter(id => {
                    const name = (items[id] || '').toLowerCase();
                    return name.includes(q) || id.includes(q);
                });
            }
            if (this._filter && this._filter !== 'all') {
                const now = Date.now();
                ids = ids.filter(id => {
                    const hasDate = !!(dates[id] && dates[id].trim());
                    if (this._filter === 'has-date') return hasDate;
                    if (this._filter === 'no-date') return !hasDate;
                    if (this._filter === 'updated') {
                        if (!hasDate) return false;
                        const parsed = Utils.parseDateToTs(dates[id]);
                        if (!parsed) return false;
                        return (now - parsed) < 7 * 24 * 60 * 60 * 1000;
                    }
                    return true;
                });
            }
            if (this._currentSort === 'none') return { ids, items, stamps, dates };
            ids.sort((a, b) => {
                if (this._currentSort === 'date') {
                    const ta = Utils.parseDateToTs(dates[a]);
                    const tb = Utils.parseDateToTs(dates[b]);
                    return this._currentDir === 'asc'
                        ? ta - tb
                        : tb - ta;
                } else if (this._currentSort === 'time') {
                    return this._currentDir === 'asc'
                        ? (stamps[a] || 0) - (stamps[b] || 0)
                        : (stamps[b] || 0) - (stamps[a] || 0);
                } else {
                    return this._currentDir === 'asc'
                        ? (items[a] || '').localeCompare(items[b] || '')
                        : (items[b] || '').localeCompare(items[a] || '');
                }
            });
            return { ids, items, stamps, dates };
        },
        _getFilteredCollections() {
            const items = this._cachedCollections || Store.loadCollections();
            const stamps = this._cachedColStamps || Store.loadCollectionTimestamps();
            const dates = this._cachedColDates || Store.loadCollectionDates();
            let ids = Object.keys(items);
            if (this._searchQuery) {
                const q = this._searchQuery.toLowerCase();
                ids = ids.filter(id => {
                    const name = (items[id] || '').toLowerCase();
                    return name.includes(q) || id.includes(q);
                });
            }
            if (this._filter && this._filter !== 'all') {
                const now = Date.now();
                ids = ids.filter(id => {
                    const hasDate = !!(dates[id] && dates[id].trim());
                    if (this._filter === 'has-date') return hasDate;
                    if (this._filter === 'no-date') return !hasDate;
                    if (this._filter === 'updated') {
                        if (!hasDate) return false;
                        const parsed = Utils.parseDateToTs(dates[id]);
                        if (!parsed) return false;
                        return (now - parsed) < 7 * 24 * 60 * 60 * 1000;
                    }
                    return true;
                });
            }
            if (this._currentSort === 'none') return { ids, items, stamps, dates };
            ids.sort((a, b) => {
                if (this._currentSort === 'date') {
                    const ta = Utils.parseDateToTs(dates[a]);
                    const tb = Utils.parseDateToTs(dates[b]);
                    return this._currentDir === 'asc'
                        ? ta - tb
                        : tb - ta;
                } else if (this._currentSort === 'time') {
                    return this._currentDir === 'asc'
                        ? (stamps[a] || 0) - (stamps[b] || 0)
                        : (stamps[b] || 0) - (stamps[a] || 0);
                } else {
                    return this._currentDir === 'asc'
                        ? (items[a] || '').localeCompare(items[b] || '')
                        : (items[b] || '').localeCompare(items[a] || '');
                }
            });
            return { ids, items, stamps, dates };
        },
        _buildTableRows(data) {
            const { ids, items, stamps, dates } = data;
            if (ids.length === 0) return '';
            const start = (this._currentPage - 1) * this._pageSize;
            const pageIds = ids.slice(start, start + this._pageSize);
            return pageIds.map((id, i) => `
                <tr data-id="${Utils.escapeHtml(id)}">
                    <td class="ws3-col-check">
                        <span class="ws3-seq-check">
                            <input type="checkbox" class="ws3-checkbox ws3-item-checkbox" data-id="${Utils.escapeHtml(id)}">
                            <span class="ws3-seq">${String((this._currentPage - 1) * this._pageSize + i + 1).padStart(2, '0')}</span>
                        </span>
                    </td>
                    <td class="ws3-col-name">
                        <span class="ws3-item-name" title="${Utils.escapeHtml(items[id] || '未知名称')}">${Utils.escapeHtml(items[id] || '未知名称')}</span>
                    </td>
                    <td class="ws3-col-id"><a class="ws3-item-link" href="https://steamcommunity.com/sharedfiles/filedetails/?id=${Utils.escapeHtml(id)}" target="_blank" rel="noopener">${Utils.escapeHtml(id)}</a></td>
                    <td class="ws3-col-date">${Utils.escapeHtml(Utils.normalizeDate(dates[id]) || '')}</td>
                    <td class="ws3-col-time">${Utils.formatTime(stamps[id] || Date.now())}</td>
                    <td class="ws3-col-actions">
                        <button class="ws3-row-btn" data-action="copy-name" data-id="${Utils.escapeHtml(id)}" title="复制名称">📝</button>
                        <button class="ws3-row-btn" data-action="copy-id" data-id="${Utils.escapeHtml(id)}" title="复制 ID">📋</button>
                        <button class="ws3-row-btn" data-action="copy-cmd" data-id="${Utils.escapeHtml(id)}" title="复制 SteamCMD">⚙️</button>
                        <button class="ws3-row-btn ws3-row-delete" data-action="delete" data-id="${Utils.escapeHtml(id)}" title="删除">✕</button>
                    </td>
                </tr>
            `).join('');
        },
        _refreshTable(modal) {
            const data = this._getFilteredData();
            const tbody = modal.querySelector('[data-table-body]');
            const emptyState = modal.querySelector('[data-empty-state]');
            const table = modal.querySelector('.ws3-table');
            tbody.innerHTML = this._buildTableRows(data);
            const hasData = data.ids.length > 0;
            table.style.display = hasData ? '' : 'none';
            emptyState.style.display = hasData ? 'none' : '';
            this._updateInfo(modal, data);
            this._updateSelection(modal);
            if (this._updatePageInput) this._updatePageInput();
        },
        _updateInfo(modal, data) {
            const total = this._currentView === 'collection'
                ? Object.keys(this._cachedCollections || {}).length
                : Object.keys(this._cachedItems || {}).length;
            const countEl = modal.querySelector('[data-info="count"]');
            const totalEl = modal.querySelector('[data-info="total"]');
            if (countEl) countEl.textContent = `(${data.ids.length} 个)`;
            if (totalEl) totalEl.textContent = total;
        },
        _updateSelection(modal) {
            const cbs = modal.querySelectorAll(SEL.ITEM_CHECKBOX);
            const checked = modal.querySelectorAll('.ws3-item-checkbox:checked');
            const selectAllCb = modal.querySelector('[data-select-all]');
            const selectedEl = modal.querySelector('[data-info="selected"]');
            if (selectedEl) selectedEl.textContent = checked.length;
            if (selectAllCb) {
                selectAllCb.checked = cbs.length > 0 && checked.length === cbs.length;
                selectAllCb.indeterminate = checked.length > 0 && checked.length < cbs.length;
            }
            const rows = modal.querySelectorAll('tbody tr[data-id]');
            rows.forEach(row => {
                const rowCb = row.querySelector(SEL.ITEM_CHECKBOX);
                row.classList.toggle('ws3-row-selected', rowCb && rowCb.checked);
            });
        },
        _syncSortButtons(modal) {
            modal.querySelectorAll('th[data-sort]').forEach(th => {
                const col = th.dataset.sort;
                const isActive = col === this._currentSort;
                th.classList.toggle('active', isActive);
                const arrow = th.querySelector('.ws3-sort-arrow');
                if (arrow) arrow.textContent = isActive ? (this._currentDir === 'asc' ? '▲' : '▼') : '↕';
            });
        },
        _getCheckedIds(modal) {
            return Array.from(modal.querySelectorAll('.ws3-item-checkbox:checked')).map(cb => cb.dataset.id);
        },
        _bindEvents(modal, closeFn) {
            this._setupPosterFlyout(modal);
            const searchInput = modal.querySelector('[data-search]');
            const searchClear = modal.querySelector('[data-search-clear]');
            const filterSelect = modal.querySelector('[data-filter]');
            searchInput.addEventListener('input', Utils.debounce(() => {
                this._searchQuery = searchInput.value.trim();
                this._currentPage = 1;
                this._refreshTable(modal);
                searchClear.style.display = this._searchQuery ? '' : 'none';
            }, CFG.DEBOUNCE_SEARCH));
            searchClear.onclick = () => {
                searchInput.value = '';
                searchInput.dispatchEvent(new Event('input'));
                searchInput.focus();
            };
            if (filterSelect) {
                filterSelect.addEventListener('change', () => {
                    this._filter = filterSelect.value;
                    this._currentPage = 1;
                    this._refreshTable(modal);
                });
            }
            this._syncSortButtons(modal);
            modal.querySelectorAll('th[data-sort]').forEach(th => {
                th.addEventListener('click', () => {
                    const col = th.dataset.sort;
                    if (this._currentSort === col) {
                        this._currentDir = this._currentDir === 'asc' ? 'desc' : 'asc';
                    } else {
                        this._currentSort = col;
                        this._currentDir = 'desc';
                    }
                    this._syncSortButtons(modal);
                    this._refreshTable(modal);
                });
            });
            const selectAllCb = modal.querySelector('[data-select-all]');
            selectAllCb.addEventListener('change', () => {
                const checked = selectAllCb.checked;
                modal.querySelectorAll(SEL.ITEM_CHECKBOX).forEach(cb => { cb.checked = checked; });
                this._updateSelection(modal);
            });
            this._updateCheckInfo(modal);
            const importFileInput = document.createElement('input');
            importFileInput.type = 'file';
            importFileInput.accept = 'application/json,.json';
            importFileInput.setAttribute('data-import-file', '');
            importFileInput.style.display = 'none';
            modal.appendChild(importFileInput);
            importFileInput.addEventListener('change', () => {
                if (importFileInput.files && importFileInput.files[0]) {
                    this._importData(modal, importFileInput.files[0]);
                }
                importFileInput.value = '';
            });
            const gameSelect = modal.querySelector(SEL.GAME_SELECT);
            this._populateGames(gameSelect);
            gameSelect.addEventListener('change', () => {
                CFG.setApp(gameSelect.value);
                this._populateGames(gameSelect);
                this._refreshTable(modal);
                this._updateCheckInfo(modal);
            });
            const typeToggle = modal.querySelector('[data-type-toggle]');
            if (typeToggle) {
                typeToggle.querySelectorAll('.ws3-type-btn').forEach(tbtn => {
                    tbtn.addEventListener('click', () => {
                        const view = tbtn.dataset.view;
                        if (view === this._currentView) return;
                        this._currentView = view;
                        typeToggle.querySelectorAll('.ws3-type-btn').forEach(b => b.classList.toggle('is-active', b === tbtn));
                        this._currentPage = 1;
                        this._searchQuery = '';
                        this._filter = 'all';
                        this._currentSort = 'none';
                        this._currentDir = 'desc';
                        const searchInput = modal.querySelector('[data-search]');
                        if (searchInput) searchInput.value = '';
                        const filterSelect = modal.querySelector('[data-filter]');
                        if (filterSelect) filterSelect.value = 'all';
                        this._refreshTable(modal);
                        this._updateInfo(modal, this._getFilteredData());
                    });
                });
            }
            const tbody = modal.querySelector('[data-table-body]');
            let lastCheckedCb = null;
            tbody.addEventListener('click', (e) => {
                const cb = e.target.closest(SEL.ITEM_CHECKBOX);
                if (cb) {
                    if (e.shiftKey && lastCheckedCb) {
                        const allCbs = Array.from(modal.querySelectorAll(SEL.ITEM_CHECKBOX));
                        const currentIdx = allCbs.indexOf(cb);
                        const lastIdx = allCbs.indexOf(lastCheckedCb);
                        if (lastIdx !== -1 && currentIdx !== -1) {
                            const [start, end] = lastIdx < currentIdx ? [lastIdx, currentIdx] : [currentIdx, lastIdx];
                            for (let i = start; i <= end; i++) allCbs[i].checked = true;
                        }
                    }
                    lastCheckedCb = cb;
                    this._updateSelection(modal);
                    return;
                }
                if (e.target.closest(SEL.DATA_ACTION)) return;
                const row = e.target.closest(SEL.ROW_BY_ID);
                if (row) {
                    const rowCb = row.querySelector(SEL.ITEM_CHECKBOX);
                    if (rowCb) {
                        rowCb.checked = !rowCb.checked;
                        lastCheckedCb = rowCb;
                        this._updateSelection(modal);
                    }
                }
            });
            const pageSizeSelect = modal.querySelector('[data-page-size]');
            if (pageSizeSelect) {
                pageSizeSelect.value = String(this._pageSize);
                pageSizeSelect.addEventListener('change', () => {
                    this._pageSize = parseInt(pageSizeSelect.value) || 50;
                    this._currentPage = 1;
                    this._refreshTable(modal);
                });
            }
            const wheelBox = modal.querySelector('.ws3-wheel-box');
            const pageDisplay = modal.querySelector('[data-page-display]');
            const pageDigits = modal.querySelector('[data-page-digits]');
            const pageCaret = modal.querySelector('[data-page-caret]');
            const totalPagesEl = modal.querySelector('[data-info="total-pages"]');
            let selStart = -1, selEnd = -1, dragging = false;
            let pendingInput = '';
            const totalPages = () => {
                const { ids } = this._getFilteredData();
                return Math.max(1, Math.ceil(ids.length / this._pageSize));
            };
            const updatePageInput = () => {
                const tp = totalPages();
                if (pageDigits) {
                    pageDigits.innerHTML = String(this._currentPage).split('').map(d => `<span class="ws3-digit">${d}</span>`).join('');
                }
                if (totalPagesEl) totalPagesEl.textContent = '/ ' + tp;
                if (pageDisplay) {
                    pageDisplay.setAttribute('aria-valuenow', String(this._currentPage));
                    pageDisplay.setAttribute('aria-valuemin', '1');
                    pageDisplay.setAttribute('aria-valuemax', String(tp));
                }
            };
            this._updatePageInput = () => updatePageInput();
            updatePageInput();
            const gotoPage = (n) => {
                const tp = totalPages();
                const target = Math.max(1, Math.min(tp, n | 0));
                if (target !== this._currentPage) { this._currentPage = target; this._refreshTable(modal); }
            };
            const setPageDigitsText = (s) => {
                if (!pageDigits) return;
                pageDigits.innerHTML = String(s).split('').map(d => `<span class="ws3-digit">${d}</span>`).join('');
            };
            const clearPending = () => { pendingInput = ''; updatePageInput(); };
            const flashReject = () => {
                if (!pageDisplay) return;
                pageDisplay.classList.add('is-reject');
                setTimeout(() => pageDisplay.classList.remove('is-reject'), 420);
            };
            const flashWheel = () => {
                if (!wheelBox) return;
                wheelBox.classList.add('is-active');
                setTimeout(() => wheelBox.classList.remove('is-active'), 160);
            };
            const onWheel = (e) => {
                e.preventDefault();
                const delta = e.deltaY < 0 ? -1 : 1;
                clearPending();
                gotoPage(this._currentPage + delta);
                flashWheel();
            };
            if (wheelBox) wheelBox.addEventListener('wheel', onWheel);
            if (pageDisplay) pageDisplay.addEventListener('wheel', onWheel);
            if (pageDisplay) {
                const clearSelection = () => {
                    selStart = selEnd = -1; dragging = false;
                    if (pageDigits) pageDigits.querySelectorAll(SEL.DIGIT).forEach(d => d.classList.remove('is-selected'));
                };
                const paintSelection = () => {
                    if (!pageDigits) return;
                    const digits = [...pageDigits.querySelectorAll(SEL.DIGIT)];
                    const lo = Math.min(selStart, selEnd), hi = Math.max(selStart, selEnd);
                    digits.forEach((d, i) => d.classList.toggle('is-selected', i >= lo && i <= hi));
                };
                pageDisplay.addEventListener('mouseenter', () => { if (pageCaret) pageCaret.classList.add('is-blink'); });
                pageDisplay.addEventListener('mouseleave', () => { if (pageCaret) pageCaret.classList.remove('is-blink'); clearSelection(); });
                pageDisplay.addEventListener('mousedown', (e) => {
                    pageDisplay.focus();
                    const digits = pageDigits ? [...pageDigits.querySelectorAll(SEL.DIGIT)] : [];
                    const idx = digits.findIndex(d => { const r = d.getBoundingClientRect(); return e.clientX >= r.left && e.clientX <= r.right; });
                    selStart = selEnd = idx >= 0 ? idx : (digits.length - 1);
                    dragging = true;
                    paintSelection();
                    e.preventDefault();
                });
                pageDisplay.addEventListener('mousemove', (e) => {
                    if (!dragging || !pageDigits) return;
                    const digits = [...pageDigits.querySelectorAll(SEL.DIGIT)];
                    const idx = digits.findIndex(d => { const r = d.getBoundingClientRect(); return e.clientX >= r.left && e.clientX <= r.right; });
                    if (idx >= 0) { selEnd = idx; paintSelection(); }
                });
                pageDisplay.addEventListener('mouseup', () => { dragging = false; });
                pageDisplay.addEventListener('keydown', (e) => {
                    if (e.isComposing) return;
                    if (e.key === 'Escape') { clearSelection(); clearPending(); return; }
                    if (e.key === 'ArrowUp') { e.preventDefault(); clearPending(); gotoPage(this._currentPage - 1); return; }
                    if (e.key === 'ArrowDown') { e.preventDefault(); clearPending(); gotoPage(this._currentPage + 1); return; }
                    if (e.key === 'Backspace' || e.key === 'Delete') {
                        e.preventDefault();
                        if (pendingInput.length > 0) {
                            pendingInput = pendingInput.slice(0, -1);
                            if (pendingInput.length > 0) {
                                const n = parseInt(pendingInput, 10);
                                setPageDigitsText(pendingInput);
                                if (n >= 1 && n <= totalPages()) gotoPage(n);
                            } else {
                                updatePageInput();
                            }
                        }
                        return;
                    }
                    if (e.key >= '0' && e.key <= '9') {
                        e.preventDefault();
                        const digits = pageDigits ? [...pageDigits.querySelectorAll(SEL.DIGIT)] : [];
                        const hasSel = selStart >= 0 && selEnd >= 0 && digits.some(d => d.classList.contains('is-selected'));
                        let str;
                        if (hasSel) {
                            const lo = Math.min(selStart, selEnd), hi = Math.max(selStart, selEnd);
                            str = digits.map((d, i) => (i >= lo && i <= hi) ? e.key : d.textContent).join('');
                        } else {
                            str = pendingInput + e.key;
                        }
                        const tp = totalPages();
                        const n = parseInt(str, 10);
                        if (isNaN(n) || n < 1 || n > tp) { flashReject(); return; }
                        pendingInput = str;
                        setPageDigitsText(str);
                        gotoPage(n);
                    }
                });
                pageDisplay.addEventListener('blur', () => { clearSelection(); clearPending(); });
            }
            modal.addEventListener('mousedown', (e) => {
                if (pageDisplay && !pageDisplay.contains(e.target)) {
                    if (pageDigits) pageDigits.querySelectorAll(SEL.DIGIT).forEach(d => d.classList.remove('is-selected'));
                    selStart = selEnd = -1; dragging = false;
                }
            });
            this._setupDragSelect(modal, tbody);
            modal.addEventListener('click', (e) => {
                const btn = e.target.closest(SEL.DATA_ACTION);
                if (btn) this._handleAction(modal, btn, closeFn);
            });
            this._bindExportMenu(modal);
            this._applyPreviewState(modal);
        },
        _handleAction(modal, btn, closeFn) {
            const action = btn.dataset.action;
            const id = btn.dataset.id;
            const checkedIds = this._getCheckedIds(modal);
            if (action === 'toggle-more') {
                const wrap = modal.querySelector('[data-more-wrap]');
                if (wrap) wrap.classList.toggle('is-open');
                return;
            }
            const moreWrap = btn.closest('[data-more-wrap]');
            if (moreWrap) moreWrap.classList.remove('is-open');
            if (id) {
                const items = this._currentView === 'collection' ? Store.loadCollections() : Store.loadItems();
                switch (action) {
                    case 'copy-name':
                        Utils.copyWithToast(items[id] || id, `已复制: ${items[id] || id}`);
                        return;
                    case 'copy-id':
                        Utils.copyWithToast(id, `已复制 ID: ${id}`);
                        return;
                    case 'copy-cmd':
                        Utils.copyWithToast(PageDetector.getSteamCmd(id), '已复制 SteamCMD 命令');
                        return;
                    case 'delete': {
                        const now = Date.now();
                        const last = Number(btn.dataset.lastClick || 0);
                        if (last && (now - last) < 1200) {
                            delete btn.dataset.lastClick;
                            btn.classList.remove('ws3-row-delete-confirm');
                            this._doDelete(modal, [id]);
                            return;
                        }
                        btn.dataset.lastClick = now;
                        btn.classList.add('ws3-row-delete-confirm');
                        Toast.warning('再次点击确认删除', 1200);
                        setTimeout(() => {
                            if (Number(btn.dataset.lastClick) === now) {
                                delete btn.dataset.lastClick;
                                btn.classList.remove('ws3-row-delete-confirm');
                            }
                        }, 1300);
                        return;
                    }
                }
            }
            const needsCheck = ['batch-delete', 'copy-selected-ids', 'copy-selected-cmds'];
            if (needsCheck.includes(action) && checkedIds.length === 0) {
                Toast.warning('请至少勾选一个模组');
                return;
            }
            switch (action) {
                case 'select-all':
                    modal.querySelectorAll(SEL.ITEM_CHECKBOX).forEach(cb => { if (!cb.hasAttribute('data-select-all')) cb.checked = true; });
                    this._updateSelection(modal);
                    break;
                case 'deselect-all':
                    modal.querySelectorAll(SEL.ITEM_CHECKBOX).forEach(cb => { if (!cb.hasAttribute('data-select-all')) cb.checked = false; });
                    this._updateSelection(modal);
                    break;
                case 'batch-delete':
                    this._confirmDelete(modal, checkedIds, closeFn);
                    break;
                case 'copy-selected-ids':
                    Utils.copyWithToast(checkedIds.join('\n'), `已复制 ${checkedIds.length} 个 ID`);
                    break;
                case 'copy-selected-cmds':
                    Utils.copyWithToast(PageDetector.getSteamCmdText(checkedIds), `已复制 ${checkedIds.length} 条 CMD`);
                    break;
                case 'toggle-data-export': {
                    const wrap = modal.querySelector('[data-data-export-wrap]');
                    if (wrap) wrap.classList.toggle('is-open');
                    break;
                }
                case 'toggle-export-info': {
                    const menu = modal.querySelector('[data-export-info-menu]');
                    if (menu) menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
                    break;
                }
                case 'export-data-all':
                    this._exportData(modal, 'all');
                    this._closeDataExportMenu(modal);
                    break;
                case 'export-data-current':
                    this._exportData(modal, 'current');
                    this._closeDataExportMenu(modal);
                    break;
                case 'import-data': {
                    const fileInput = modal.querySelector('[data-import-file]');
                    if (fileInput) fileInput.click();
                    break;
                }
                case 'open-newtab':
                    this._openManagerInNewTab(modal);
                    break;
                case 'clear-all':
                    this._showConfirm(modal, Object.keys(this._currentView === 'collection' ? Store.loadCollections() : Store.loadItems()), closeFn);
                    break;
                case 'check-updates':
                    if (this._checking) { this._checking = false; const cb = modal.querySelector('[data-action="check-updates"]'); if (cb) cb.textContent = '🔄 检查更新'; return; }
                    this._checkModUpdates(modal);
                    break;
                case 'toggle-preview':
                    this._togglePreview(modal, btn);
                    break;
                case 'prev-page':
                    if (this._currentPage > 1) { this._currentPage--; this._refreshTable(modal); }
                    break;
                case 'next-page': {
                    const totalPages = Math.ceil(this._getFilteredData().ids.length / this._pageSize);
                    if (this._currentPage < totalPages) { this._currentPage++; this._refreshTable(modal); }
                    break;
                }
            }
        },
        _togglePreview(modal, btn) {
            this._previewEnabled = !this._previewEnabled;
            GM_setValue(KEYS.PREVIEW_ENABLED, this._previewEnabled);
            if (this._previewEnabled) {
                btn.classList.add(CLS.BTN_ACCENT);
                btn.classList.remove(CLS.BTN_SECONDARY);
                btn.textContent = '🖼 预览·开';
            } else {
                btn.classList.add(CLS.BTN_SECONDARY);
                btn.classList.remove(CLS.BTN_ACCENT);
                btn.textContent = '🖼 预览·关';
                const flyout = document.querySelector('.ws3-poster-flyout');
                if (flyout) { flyout.classList.remove('show'); flyout.innerHTML = ''; }
            }
        },
        _applyPreviewState(modal) {
            const btn = modal.querySelector('[data-action="toggle-preview"]');
            if (!btn) return;
            if (this._previewEnabled) {
                btn.classList.add(CLS.BTN_ACCENT);
                btn.classList.remove(CLS.BTN_SECONDARY);
                btn.textContent = '🖼 预览·开';
            } else {
                btn.classList.add(CLS.BTN_SECONDARY);
                btn.classList.remove(CLS.BTN_ACCENT);
                btn.textContent = '🖼 预览·关';
            }
        },
        _showConfirm(modal, ids, closeFn) {
            const confirmBar = modal.querySelector('[data-confirm-bar]');
            const msgEl = confirmBar.querySelector('.ws3-confirm-msg');
            const isCol = this._currentView === 'collection';
            const items = isCol ? Store.loadCollections() : Store.loadItems();
            const total = Object.keys(items).length;
            const unit = isCol ? '合集' : '模组';
            if (ids.length === total) {
                if (total === 1) {
                    msgEl.textContent = `确定要清空收藏夹中唯一的${unit}「${items[ids[0]] || ids[0]}」吗？`;
                } else {
                    msgEl.textContent = `确定要清空收藏夹中的全部 ${total} 个${unit}吗？此操作不可撤销。`;
                }
            } else if (ids.length === 1) {
                msgEl.textContent = `确定清除「${items[ids[0]] || ids[0]}」吗？`;
            } else {
                msgEl.textContent = `确定要删除选中的 ${ids.length} 个${unit}吗？`;
            }
            confirmBar.style.display = 'flex';
            const cleanup = () => {
                confirmBar.style.display = 'none';
                confirmBar.querySelector('[data-confirm-yes]').removeEventListener('click', onYes);
                confirmBar.querySelector('[data-confirm-no]').removeEventListener('click', onNo);
            };
            const onYes = () => {
                cleanup();
                if (ids.length === total) {
                    if (isCol) Store.removeCollections(ids); else Store.clearItems();
                    closeFn();
                    Toast.success(isCol ? '已全部清空合集' : '已全部清空');
                } else {
                    const removed = isCol ? Store.removeCollections(ids) : Store.removeItems(ids);
                    Toast.success(`已删除 ${removed} 个${unit}`);
                    if (Object.keys(isCol ? Store.loadCollections() : Store.loadItems()).length === 0) {
                        closeFn();
                    } else {
                        this._refreshTable(modal);
                        const gs = modal.querySelector(SEL.GAME_SELECT);
                        if (gs) this._populateGames(gs);
                    }
                }
            };
            const onNo = () => cleanup();
            confirmBar.querySelector('[data-confirm-yes]').addEventListener('click', onYes);
            confirmBar.querySelector('[data-confirm-no]').addEventListener('click', onNo);
        },
        _confirmDelete(modal, ids, closeFn) {
            this._showConfirm(modal, ids, closeFn);
        },
        _doDelete(modal, ids) {
            const isCol = this._currentView === 'collection';
            const items = isCol ? Store.loadCollections() : Store.loadItems();
            const unit = isCol ? '合集' : '模组';
            const total = Object.keys(items).length;
            if (ids.length === total) {
                if (isCol) Store.removeCollections(ids); else Store.clearItems();
                Toast.success(isCol ? '已全部清空合集' : '已全部清空');
                const backdrop = modal.closest('.ws3-modal-backdrop');
                if (backdrop) backdrop.remove();
            } else {
                const removed = isCol ? Store.removeCollections(ids) : Store.removeItems(ids);
                Toast.success(`已删除 ${removed} 个${unit}`);
                this._reloadCache();
                this._refreshTable(modal);
                const gs = modal.querySelector(SEL.GAME_SELECT);
                if (gs) this._populateGames(gs);
            }
        },
        _updateCheckInfo(modal) {
            const info = Store.loadLastCheck();
            const el = modal.querySelector('[data-check-info]');
            if (el && info && info.time) {
                el.textContent = '上次检查更新: ' + Utils.formatTime(info.time);
                el.style.display = '';
            }
        },
        _populateGames(select) {
            Store.pruneEmptyGames();
            const gameNames = Store.loadGameNames();
            const appIds = new Set();
            for (const gid of Object.keys(gameNames)) {
                if (!gid) continue;
                let hasItems = false;
                let hasCols = false;
                try {
                    const d = JSON.parse(GM_getValue(KEYS.ITEMS_PREFIX + gid, '{}'));
                    if (d && Object.keys(d).length > 0) hasItems = true;
                } catch (e) { }
                try {
                    const c = JSON.parse(GM_getValue(KEYS.COLLECTIONS_PREFIX + gid, '{}'));
                    if (c && Object.keys(c).length > 0) hasCols = true;
                } catch (e) { }
                if (hasItems || hasCols) appIds.add(gid);
            }
            try {
                if (typeof GM_listValues === 'function') {
                    const allKeys = GM_listValues();
                    for (const k of allKeys) {
                        if ((k.startsWith(KEYS.ITEMS_PREFIX) && k !== KEYS.ITEMS) || (k.startsWith(KEYS.COLLECTIONS_PREFIX) && k !== KEYS.COLLECTIONS)) {
                            const prefix = k.startsWith(KEYS.ITEMS_PREFIX) ? KEYS.ITEMS_PREFIX : KEYS.COLLECTIONS_PREFIX;
                            const id = k.substring(prefix.length);
                            if (id && id !== '0') {
                                try { const data = JSON.parse(GM_getValue(k, '{}')); if (data && Object.keys(data).length > 0) appIds.add(id); } catch (e) { }
                            }
                        }
                    }
                }
            } catch (e) { }
            appIds.add(CFG._appId);
            const seen = new Set();
            const deduped = [];
            for (const id of [...appIds].sort()) {
                if (seen.has(id)) continue;  
                seen.add(id);
                const name = (gameNames[id] || id).trim();
                deduped.push({ id, name });
            }
            select.innerHTML = '';
            if (deduped.length === 0) {
                select.disabled = true;
                return;
            }
            select.disabled = false;
            for (const { id, name } of deduped) {
                const opt = document.createElement('option');
                opt.value = id;
                opt.textContent = name;
                select.appendChild(opt);
            }
            const currentId = deduped.find(d => d.id === CFG._appId) ? CFG._appId : deduped[0].id;
            select.value = currentId;
        },
        async _checkModUpdates(modal) {
            const isCollection = this._currentView === 'collection';
            const { ids } = isCollection ? this._getFilteredCollections() : this._getFilteredMods();
            const label = isCollection ? '合集' : '模组';
            if (ids.length === 0) { Toast.warning('当前筛选下无可检查的' + label); return; }
            this._checking = true;
            const lastCheck = Store.loadLastCheck();
            const lastDates = (lastCheck && lastCheck.dates) || {};
            const newDates = {};
            const updatedIds = new Set();
            const failedIds = new Set();
            const btn = modal.querySelector('[data-action="check-updates"]');
            if (btn) { btn.disabled = false; btn.textContent = '\u274C \u53D6\u6D88\u68C0\u67E5 (0/' + ids.length + ')'; }
            const dates = isCollection ? Store.loadCollectionDates() : Store.loadItemDates();
            const noDate = ids.filter(id => !(dates[id] && String(dates[id]).trim()));
            const hasDate = ids.filter(id => !noDate.includes(id));
            if (noDate.length > 0) Toast.warning('有 ' + noDate.length + ' 个无更新时间' + label + '，优先获取');
            let completed = 0;
            let cancelled = false;
            const runGroup = async (group) => {
                for (const id of group) {
                    if (!this._checking) { cancelled = true; return; }
                    try {
                        const info = isCollection
                            ? await ModFetcher.fetchCollectionDetails(id)
                            : await ModFetcher.fetchDetails(id, { forceRefresh: true });
                        completed++;
                        if (btn) btn.textContent = '\u274C \u53D6\u6D88\u68C0\u67E5 (' + completed + '/' + ids.length + ')';
                        if (info.failed) { failedIds.add(id); continue; }
                        const date = info.date || '';
                        if (date) {
                            newDates[id] = date;
                            if (lastDates[id] && lastDates[id] !== date) updatedIds.add(id);
                        }
                    } catch (e) { failedIds.add(id); }
                }
            };
            await runGroup(noDate);
            if (!cancelled && this._checking) await runGroup(hasDate);
            this._checking = false;
            if (cancelled) {
                Toast.warning('已取消检查');
                if (btn) { btn.disabled = false; btn.textContent = '\u{1F504} 检查更新'; }
                return;
            }
            for (const id of ids) {
                if (newDates[id]) {
                    if (isCollection) Store.saveCollectionDate(id, newDates[id]);
                    else Store.saveItemDate(id, newDates[id]);
                }
            }
            Store.saveLastCheck(Date.now(), newDates);
            modal.querySelectorAll(SEL.ROW_BY_ID).forEach(row => row.classList.remove('ws3-row-updated'));
            this._reloadCache();
            this._refreshTable(modal);
            modal.querySelectorAll(SEL.ROW_BY_ID).forEach(row => {
                if (updatedIds.has(row.dataset.id)) row.classList.add('ws3-row-updated');
            });
            this._updateCheckInfo(modal);
            if (btn) { btn.disabled = false; btn.textContent = '\u{1F504} 检查更新'; }
            if (failedIds.size > 0) {
                Toast.warning(`${failedIds.size} 个检查失败（受限流），请稍后重试`);
            } else {
                const count = updatedIds.size;
                Toast.success(count ? `${count} 个${label}有更新` : `所有${label}已是最新`);
            }
        },
        _bindExportMenu(modal) {
            modal.querySelectorAll('[data-export-scope]').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const itemEl = btn.closest('[data-export-type]');
                    const type = itemEl.dataset.exportType;
                    const scope = btn.dataset.exportScope;
                    this._handleExport(type, scope, modal);
                });
            });
            const onDocClick = (e) => {
                if (!document.documentElement.contains(modal)) {
                    document.removeEventListener('click', onDocClick);
                    return;
                }
                const dataWrap = modal.querySelector('[data-data-export-wrap]');
                if (dataWrap && !dataWrap.contains(e.target)) this._closeDataExportMenu(modal);
                const infoWrap = modal.querySelector('[data-export-info-wrap]');
                if (infoWrap && !infoWrap.contains(e.target)) this._closeExportInfoMenu(modal);
            };
            document.addEventListener('click', onDocClick);
        },
        _handleExport(type, scope, modal) {
            const data = this._getFilteredData();
            let ids;
            if (scope === 'checked') {
                ids = this._getCheckedIds(modal);
                if (ids.length === 0) { Toast.warning('请先勾选要导出的模组'); return; }
            } else if (scope === 'page') {
                const start = (this._currentPage - 1) * this._pageSize;
                ids = data.ids.slice(start, start + this._pageSize);
            } else {
                ids = data.ids.slice();
            }
            if (ids.length === 0) { Toast.warning('没有可导出的模组'); return; }
            const items = Store.loadItems();
            const dates = Store.loadItemDates();
            const stamps = Store.loadTimestamps();
            const appId = PageDetector.getAppId() || '?';
            const gameName = PageDetector.getGameName() || '未知游戏';
            const safeName = (gameName || '未知游戏').replace(/[\\/:*?"<>|\r\n\t]+/g, '_').trim() || '未知游戏';
            if (type === 'all') {
                const html = this._buildViewerHtml(ids, items, dates, stamps, appId, PageDetector.getGameName(), 'export');
                this._downloadHtml(html, `${safeName}_${appId}_all_${Date.now()}.html`);
                Toast.success(`已导出 ${ids.length} 个模组全部信息`);
                return;
            }
            let content, filename, label;
            if (type === 'name') {
                content = ids.map(id => items[id] || id).join('\n');
                filename = `${safeName}_${appId}_names_${Date.now()}.html`;
                label = '名称';
            } else if (type === 'id') {
                content = ids.join('\n');
                filename = `${safeName}_${appId}_ids_${Date.now()}.html`;
                label = 'ID';
            } else if (type === 'cmd') {
                content = PageDetector.getSteamCmdText(ids);
                filename = `${safeName}_${appId}_cmds_${Date.now()}.html`;
                label = 'CMD';
            } else {
                content = ids.map(id => `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`).join('\n');
                filename = `${safeName}_${appId}_links_${Date.now()}.html`;
                label = '链接';
            }
            this._exportSimpleHtml(label, content, filename, ids.length);
        },
        _exportSimpleHtml(label, content, filename, count) {
            const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Steam 创意工坊 ${label} 导出</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #1b2838; color: #c6d4df; padding: 20px; }
  h1 { color: #66c0f4; font-size: 18px; }
  pre { white-space: pre-wrap; word-break: break-all; background: #16202d; padding: 14px; border-radius: 8px; border: 1px solid #354f6e; font-size: 13px; line-height: 1.6; }
  button { background: #2a3f5f; color: #e2e9f0; border: none; padding: 8px 14px; border-radius: 6px; cursor: pointer; font-size: 13px; }
  button:hover { background: #354f6e; }
</style>
</head>
<body>
  <h1>Steam 创意工坊 · ${label} 导出（共 ${count} 个）</h1>
  <button id="cp">复制全部</button>
  <pre id="c">${Utils.escapeHtml(content)}</pre>
  <script>
    document.getElementById('cp').onclick = function () {
      var t = document.getElementById('c').textContent;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(t).then(function () { alert('已复制'); });
      } else {
        var ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); alert('已复制'); } catch (e) { alert('复制失败'); }
        ta.remove();
      }
    };
  </script>
</body>
</html>`;
            this._downloadHtml(html, filename);
        },
        _buildViewerHtml(ids, items, dates, stamps, appId, gameName, mode) {
            const gname = Utils.escapeHtml(gameName || '未知游戏');
            const aid = appId || '?';
            const home = 'https://steamcommunity.com/workshop/browse/?appid=' + aid;
            const count = ids.length;
            const titleText = mode === 'newtab'
                ? `${gname} · ${aid} · Steam 创意工坊收藏管理器`
                : `${gname} · ${aid} · 创意工坊 · 全部信息 导出（共 ${count} 个）`;
            const allInfo = ids.map(id => {
                const name = items[id] || id;
                const link = `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`;
                const cmd = PageDetector.getSteamCmd(id);
                const date = dates[id] || '';
                const time = stamps[id] ? Utils.formatTime(stamps[id]) : '';
                return `${name}\t${id}\t${date}\t${time}\t${link}\t${cmd}`;
            });
            const rowsHtml = ids.map((id, i) => {
                const name = Utils.escapeHtml(items[id] || id);
                const link = `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`;
                const date = Utils.escapeHtml(dates[id] || '');
                const time = stamps[id] ? Utils.formatTime(stamps[id]) : '';
                return `<tr data-idx="${i}"><td class="seq">${String(i + 1).padStart(2, '0')}</td><td class="cname" title="${name}">${name}</td><td><a href="${link}" target="_blank" rel="noopener">${id}</a></td><td>${date}</td><td>${time}</td><td class="ops"><button class="rowbtn" onclick="ws3CopyRow(this)">复制整行</button></td></tr>`;
            }).join('\n');
            const now = new Date().toLocaleString();
            const infoJson = JSON.stringify(allInfo).replace(/</g, '\\u003c');
            const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${titleText}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; background: #1b2838; color: #c6d4df; }
  .hd { padding: 16px 20px; background: #16202d; border-bottom: 1px solid #354f6e; position: sticky; top: 0; z-index: 5; }
  h1 { color: #66c0f4; font-size: 18px; margin: 0 0 4px; }
  .hd h1 a { color: #66c0f4; text-decoration: none; }
  .hd h1 a:hover { text-decoration: underline; }
  .meta { color: #8f98a0; font-size: 12px; }
  .bar { margin-top: 10px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .b { background: #2a3f5f; color: #e2e9f0; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; }
  .b:hover { background: #354f6e; }
  .b:disabled { opacity: 0.4; cursor: default; }
  .sel { background: #212d3d; color: #e2e9f0; border: 1px solid #354f6e; border-radius: 6px; padding: 5px 8px; font-size: 12px; }
  .pg { font-size: 12px; color: #b0b9c3; margin: 0 6px; }
  .tip { font-size: 12px; color: #66c0f4; }
  .pgwrap { margin-left: auto; display: flex; align-items: center; gap: 6px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #212d3d; padding: 10px 14px; text-align: left; font-weight: 600; color: #8f98a0; font-size: 11px; border-bottom: 2px solid #354f6e; position: sticky; top: 92px; }
  td { padding: 9px 14px; border-bottom: 1px solid #2a3f5f; font-size: 13px; }
  td.cname { max-width: 360px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  tr:hover { background: rgba(102,192,244,0.05); }
  a { color: #66c0f4; text-decoration: none; }
  a:hover { color: #7dc9f5; text-decoration: underline; }
  .rowbtn { background: #2a3f5f; color: #e2e9f0; border: none; padding: 4px 10px; border-radius: 5px; cursor: pointer; font-size: 12px; }
  .rowbtn:hover { background: #354f6e; }
  th.sortable { cursor: pointer; user-select: none; transition: background .15s, color .15s; }
  th.sortable:hover { background: #2a3f5f; color: #c6d4df; }
  th.sortable.active { color: #66c0f4; border-bottom-color: #66c0f4; }
  th .ws3-sort-arrow { margin-left: 4px; font-size: 10px; color: #5c6b7a; }
  th.sortable.active .ws3-sort-arrow { color: #66c0f4; }
  th.seq, td.seq { width: 40px; min-width: 40px; max-width: 40px; text-align: center; }
  th.seq { background: #1b2838; color: #5c6b7a; }
  td.seq { padding: 9px 2px; font-family: 'Cascadia Code','Fira Code','Consolas',monospace; font-size: 12px; color: #7e8894; text-align: center; background: rgba(255,255,255,0.025); }
  tr:hover td.seq { background: rgba(102,192,244,0.05); }
  </style>
</head>
<body>
  <div class="hd">
    <h1><a href="${home}" target="_blank" rel="noopener">${titleText}</a></h1>
    <div class="meta">AppID: ${appId} · 共 ${ids.length} 个模组 · 导出时间: ${now}</div>
    <div class="bar">
      <button id="copyall" class="b">复制全部信息</button>
      <span id="tip" class="tip"></span>
      <span class="pgwrap">每页<select id="ps" class="sel"><option>50</option><option selected>100</option><option>200</option><option>500</option><option>全部</option></select>个
        <button id="prev" class="b">◀</button><span id="pg" class="pg"></span><button id="next" class="b">▶</button></span>
    </div>
  </div>
  <table class="tbl">
    <thead><tr><th class="seq">#</th><th class="sortable" data-sort="name" onclick="ws3Sort('name')">名称<span class="ws3-sort-arrow">↕</span></th><th>ID</th><th class="sortable" data-sort="date" onclick="ws3Sort('date')">更新时间<span class="ws3-sort-arrow">↕</span></th><th class="sortable" data-sort="time" onclick="ws3Sort('time')">添加时间<span class="ws3-sort-arrow">↕</span></th><th>操作</th></tr></thead>
    <tbody id="tbody">${rowsHtml}</tbody>
  </table>
  <script>
    var ws3INFO = ${infoJson};
        var ws3Rows = Array.prototype.slice.call(document.querySelectorAll('#tbody tr'));
        var ws3Meta = ${JSON.stringify(ids.map((id, idx) => ({ name: (items[id]||id), id: id, date: (dates[id]||''), time: (stamps[id]||0) })))};
        var ws3SortKey = null, ws3SortDir = 1;
        var ws3Page = 1, ws3Ps = 100;
    function ws3Show() {
      var s = (ws3Page - 1) * ws3Ps;
      ws3Rows.forEach(function (r, i) { r.style.display = (i >= s && i < s + ws3Ps) ? '' : 'none'; });
      var tp = Math.max(1, Math.ceil(ws3Rows.length / ws3Ps));
      document.getElementById('pg').textContent = '第 ' + ws3Page + ' / ' + tp + ' 页';
      document.getElementById('prev').disabled = ws3Page <= 1;
      document.getElementById('next').disabled = ws3Page >= tp;
    }
    function ws3Sort(key) {
      if (ws3SortKey === key) ws3SortDir = -ws3SortDir; else { ws3SortKey = key; ws3SortDir = 1; }
      var tb = document.getElementById('tbody');
      var rows = Array.prototype.slice.call(tb.querySelectorAll('tr[data-idx]'));
      rows.sort(function (a, b) {
        var ia = +a.getAttribute('data-idx'), ib = +b.getAttribute('data-idx');
        var ma = ws3Meta[ia], mb = ws3Meta[ib];
        var r = 0;
        if (key === 'name') r = String(ma.name).localeCompare(String(mb.name), 'zh');
        else if (key === 'date') r = String(ma.date).localeCompare(String(mb.date));
        else if (key === 'time') r = (ma.time || 0) - (mb.time || 0);
        return r * ws3SortDir;
      });
      var newRows = [], newInfo = [], newMeta = [];
      rows.forEach(function (tr, i) {
        var old = +tr.getAttribute('data-idx');
        newRows.push(ws3Rows[old]); newInfo.push(ws3INFO[old]); newMeta.push(ws3Meta[old]);
        tr.setAttribute('data-idx', i);
        tb.appendChild(tr);
      });
      ws3Rows = newRows; ws3INFO = newInfo; ws3Meta = newMeta;
      document.querySelectorAll('th.sortable').forEach(function (th) {
        var ar = th.querySelector('.ws3-sort-arrow');
        if (th.getAttribute('data-sort') === ws3SortKey) {
          th.classList.add('active');
          if (ar) ar.textContent = ws3SortDir === 1 ? '▲' : '▼';
        } else { th.classList.remove('active'); if (ar) ar.textContent = '↕'; }
      });
      ws3Show();
    }
    function ws3Tip(m) { var e = document.getElementById('tip'); e.textContent = m; setTimeout(function () { e.textContent = ''; }, 1500); }
    function ws3Fallback(t) {
      var ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); ws3Tip('已复制'); } catch (e) { ws3Tip('复制失败'); }
      ta.remove();
    }
    function ws3CopyText(t) {
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(t).then(function () { ws3Tip('已复制'); }, function () { ws3Fallback(t); }); }
      else { ws3Fallback(t); }
    }
    function ws3CopyRow(b) { var i = b.closest('tr').getAttribute('data-idx'); ws3CopyText(ws3INFO[+i]); }
    document.getElementById('copyall').onclick = function () { ws3CopyText(ws3INFO.join('\\n')); };
    document.getElementById('prev').onclick = function () { if (ws3Page > 1) { ws3Page--; ws3Show(); } };
    document.getElementById('next').onclick = function () { ws3Page++; ws3Show(); };
    document.getElementById('ps').onchange = function (e) { ws3Ps = (e.target.value === '全部') ? 999999 : (+e.target.value); ws3Page = 1; ws3Show(); };
    ws3Show();
  </script>
</body>
</html>`;
            return html;
        },
        _downloadHtml(html, filename) {
            const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        },
        _downloadJson(obj, filename) {
            const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        },
        _closeDataExportMenu(modal) {
            const wrap = modal.querySelector('[data-data-export-wrap]');
            if (wrap) wrap.classList.remove('is-open');
        },
        _closeExportInfoMenu(modal) {
            const menu = modal.querySelector('[data-export-info-menu]');
            if (menu) menu.style.display = 'none';
        },
        readGame(appId) {
            const parse = (key) => {
                try { return JSON.parse(GM_getValue('ws3_' + key + '_' + appId, '{}')) || {}; }
                catch (e) { return {}; }
            };
            const name = (Store.loadGameNames() || {})[appId] || '';
            return {
                appId: String(appId),
                name: name,
                items: parse('items'),
                timestamps: parse('timestamps'),
                dates: parse('item_dates'),
                posters: parse('posters'),
                collections: parse('collections'),
                collectionTimestamps: parse('collection_timestamps'),
                collectionDates: parse('collection_dates'),
                collectionPosters: parse('collection_posters')
            };
        },
        _exportData(modal, scope) {
            Store.pruneEmptyGames();
            let games = [];
            if (scope === 'all') {
                const appIds = new Set();
                const names = Store.loadGameNames() || {};
                Object.keys(names).forEach(id => { if (id && id !== '0') appIds.add(id); });
                try {
                    if (typeof GM_listValues === 'function') {
                        GM_listValues().forEach(k => {
                            if (k && ((k.indexOf(KEYS.ITEMS_PREFIX) === 0 && k !== KEYS.ITEMS) || (k.indexOf(KEYS.COLLECTIONS_PREFIX) === 0 && k !== KEYS.COLLECTIONS))) {
                                const prefix = k.indexOf(KEYS.ITEMS_PREFIX) === 0 ? KEYS.ITEMS_PREFIX : KEYS.COLLECTIONS_PREFIX;
                                const id = k.substring(prefix.length);
                                if (id && id !== '0') appIds.add(id);
                            }
                        });
                    }
                } catch (e) { }
                appIds.forEach(id => { const g = this.readGame(id); if (g && ((g.items && Object.keys(g.items).length > 0) || (g.collections && Object.keys(g.collections).length > 0))) games.push(g); });
            } else {
                const gs = modal.querySelector(SEL.GAME_SELECT);
                const appId = gs ? gs.value : (CFG._appId || '0');
                if (!appId || appId === '0') { Toast.warning('请先选择要导出的游戏'); return; }
                games = [this.readGame(appId)];
            }
            if (!games.length) { Toast.warning('没有可导出的数据'); return; }
            const payload = {
                format: 'ws3-collection-backup',
                version: 1,
                exportedAt: new Date().toISOString(),
                generator: 'Steam Workshop Optimizer',
                _schema: {
                    items: '模组ID→名称 映射 {id: name}',
                    timestamps: '模组ID→加入收藏夹的时间戳(ms) {id: number}',
                    dates: "模组ID→最后更新日期文本 {id: 'YYYY年M月D日'}",
                    posters: '模组ID→海报图URL {id: url}',
                    collections: '合集ID→名称 映射 {id: name}',
                    collectionTimestamps: '合集ID→加入收藏夹的时间戳(ms) {id: number}',
                    collectionDates: '合集ID→更新日期文本 {id: date}',
                    collectionPosters: '合集ID→封面图URL {id: url}'
                },
                gameNames: Store.loadGameNames() || {},
                games: games.map(g => Object.assign({}, g, {
                    _desc: {
                        items: '模组ID→名称',
                        timestamps: '加入时间戳(ms)',
                        dates: '更新日期',
                        posters: '海报URL',
                        collections: '合集ID→名称',
                        collectionTimestamps: '合集加入时间戳(ms)',
                        collectionDates: '合集更新日期',
                        collectionPosters: '合集封面URL'
                    }
                }))
            };
            const pad = (n) => String(n).padStart(2, '0');
            const d = new Date();
            const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
            const fname = 'SteamMOD-backup-' + ts + '.json';
            this._downloadJson(payload, fname);
            Toast.success('已导出 ' + games.length + ' 个游戏');
        },
        async _importData(modal, file) {
            if (!file) return;
            let text;
            try { text = await file.text(); }
            catch (e) { Toast.error('无法读取文件'); return; }
            let obj;
            try { obj = JSON.parse(text); }
            catch (e) { Toast.error('文件不是有效的 JSON'); return; }
            if (!obj || obj.format !== 'ws3-collection-backup' || typeof obj.version !== 'number' || !Array.isArray(obj.games)) {
                Toast.error('文件格式无效或不受支持');
                return;
            }
            if (obj.version > 1) Toast.warning('文件版本较新，已尽力导入');
            const fieldMap = { items: 'items', timestamps: 'timestamps', dates: 'item_dates', posters: 'posters',
                collections: 'collections', collectionTimestamps: 'collection_timestamps', collectionDates: 'collection_dates', collectionPosters: 'collection_posters' };
            let imported = 0;
            obj.games.forEach(g => {
                if (!g || !g.appId) return;
                const appId = String(g.appId);
                if (!appId || appId === '0') return;
                Object.keys(fieldMap).forEach(field => {
                    if (field.charAt(0) === '_') return;
                    const incoming = g[field];
                    if (incoming && typeof incoming === 'object' && !Array.isArray(incoming)) {
                        let existing = {};
                        try { existing = JSON.parse(GM_getValue('ws3_' + fieldMap[field] + '_' + appId, '{}')) || {}; }
                        catch (e) { existing = {}; }
                        const merged = Object.assign(existing, incoming);
                        GM_setValue('ws3_' + fieldMap[field] + '_' + appId, JSON.stringify(merged));
                    }
                });
                imported++;
            });
            if (obj.gameNames && typeof obj.gameNames === 'object') {
                const names = Store.loadGameNames() || {};
                Object.keys(obj.gameNames).forEach(id => {
                    const nm = obj.gameNames[id];
                    if (nm && (!names[id] || names[id] !== nm)) names[id] = nm;
                });
                GM_setValue(KEYS.GAME_NAMES, JSON.stringify(names));
            }
            Store._notify();
            this._reloadCache();
            this._refreshTable(modal);
            const gs = modal.querySelector(SEL.GAME_SELECT);
            if (gs) this._populateGames(gs);
            this._updateSelection(modal);
            Toast.success('已恢复 ' + imported + ' 个游戏的数据');
        },
        _openManagerInNewTab(modal) {
            const items = Store.loadItems();
            if (Object.keys(items).length === 0) { Toast.warning('收藏夹为空，无法打开'); return; }
            const dates = Store.loadItemDates();
            const stamps = Store.loadTimestamps();
            const appId = PageDetector.getAppId() || '?';
            const ids = Object.keys(items);
            const html = this._buildViewerHtml(ids, items, dates, stamps, appId, PageDetector.getGameName(), 'newtab');
            const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const w = window.open(url, '_blank');
            if (!w) {
                Toast.warning('浏览器拦截了新标签，已改为下载 HTML');
                this._downloadHtml(html, `steam_mods_${appId}_${Date.now()}.html`);
            } else {
                Toast.success('已在新标签打开收藏管理器');
            }
            setTimeout(() => URL.revokeObjectURL(url), 60000);
        },
        _setupDragSelect(modal, tbody) {
            tbody.addEventListener('mousedown', (e) => {
                if (e.target.closest('button') || e.target.closest('input')) return;
                const startX = e.clientX;
                const startY = e.clientY;
                let rectEl = null;
                let hasMoved = false;
                const onMove = (ev) => {
                    if (!hasMoved) {
                        if (Math.abs(ev.clientX - startX) < CFG.DRAG_THRESHOLD && Math.abs(ev.clientY - startY) < CFG.DRAG_THRESHOLD) return;
                        hasMoved = true;
                        rectEl = document.createElement('div');
                        rectEl.className = 'ws3-select-rect';
                        document.documentElement.appendChild(rectEl);
                    }
                    const x = Math.min(startX, ev.clientX);
                    const y = Math.min(startY, ev.clientY);
                    const w = Math.abs(ev.clientX - startX);
                    const h = Math.abs(ev.clientY - startY);
                    rectEl.style.left = x + 'px';
                    rectEl.style.top = y + 'px';
                    rectEl.style.width = w + 'px';
                    rectEl.style.height = h + 'px';
                    const rows = modal.querySelectorAll('tbody tr[data-id]');
                    rows.forEach(row => {
                        const rowRect = row.getBoundingClientRect();
                        const hits = !(rowRect.right < x || rowRect.left > x + w || rowRect.bottom < y || rowRect.top > y + h);
                        row.classList.toggle('ws3-row-boxed', hits);
                    });
                };
                const onUp = () => {
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                    if (rectEl) {
                        const rRect = rectEl.getBoundingClientRect();
                        const rows = modal.querySelectorAll('tbody tr[data-id]');
                        const inside = [];
                        rows.forEach(row => {
                            const rowRect = row.getBoundingClientRect();
                            const hits = !(
                                rowRect.right < rRect.left ||
                                rowRect.left > rRect.right ||
                                rowRect.bottom < rRect.top ||
                                rowRect.top > rRect.bottom
                            );
                            if (hits) inside.push(row);
                        });
                        rectEl.remove();
                        rows.forEach(row => row.classList.remove('ws3-row-boxed'));
                        if (inside.length === 0) {
                            return;
                        }
                        const allChecked = inside.every(row => {
                            const cb = row.querySelector(SEL.ITEM_CHECKBOX);
                            return cb && cb.checked;
                        });
                        if (allChecked) {
                            inside.forEach(row => {
                                const cb = row.querySelector(SEL.ITEM_CHECKBOX);
                                if (cb) cb.checked = false;
                            });
                        } else {
                            rows.forEach(row => {
                                const cb = row.querySelector(SEL.ITEM_CHECKBOX);
                                if (cb) cb.checked = false;
                            });
                            inside.forEach(row => {
                                const cb = row.querySelector(SEL.ITEM_CHECKBOX);
                                if (cb) cb.checked = true;
                            });
                        }
                        this._updateSelection(modal);
                    }
                };
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
                e.preventDefault();
            });
        },
        _setupPosterFlyout(modal) {
            const flyout = document.createElement('div');
            flyout.className = 'ws3-poster-flyout';
            document.documentElement.appendChild(flyout);
            let activeRow = null;
            let hoverTimer = null;
            let countdownEl = null;
            let circleEl = null;
            let lastX = 0, lastY = 0;
            const CIRC_C = 50.27;
            const removeCountdown = () => {
                if (countdownEl) { countdownEl.remove(); countdownEl = null; circleEl = null; }
                if (hoverTimer) { cancelAnimationFrame(hoverTimer); hoverTimer = null; }
            };
            const hideFlyout = () => { flyout.classList.remove('show'); flyout.innerHTML = ''; };
            const startCountdown = (row, id) => {
                removeCountdown();
                activeRow = row;
                countdownEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                countdownEl.classList.add('ws3-countdown');
                countdownEl.setAttribute('viewBox', '0 0 20 20');
                countdownEl.style.position = 'fixed';
                countdownEl.style.left = (lastX - 10) + 'px';
                countdownEl.style.top = (lastY - 10) + 'px';
                countdownEl.style.zIndex = '2147483647';
                countdownEl.style.pointerEvents = 'none';
                circleEl = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                circleEl.setAttribute('cx', '10'); circleEl.setAttribute('cy', '10');
                circleEl.setAttribute('r', '8');
                circleEl.setAttribute('stroke-dasharray', String(CIRC_C));
                circleEl.setAttribute('stroke-dashoffset', String(CIRC_C));
                countdownEl.appendChild(circleEl);
                document.documentElement.appendChild(countdownEl);
                let done = false;
                let fetchStarted = false;
                const tick = () => {
                    if (activeRow !== row || !circleEl) { removeCountdown(); return; }
                    countdownEl.style.left = (lastX - 10) + 'px';
                    countdownEl.style.top = (lastY - 10) + 'px';
                    if (fetchStarted) {
                        circleEl.setAttribute('stroke-dashoffset', (CIRC_C * 0.1).toFixed(2));
                    } else {
                        const elapsed = performance.now() - countdownStart;
                        const progress = Math.min(1, elapsed / 1000);
                        circleEl.setAttribute('stroke-dashoffset', (CIRC_C * (1 - progress)).toFixed(2));
                    }
                    if (done) {
                        countdownEl.classList.remove('spinning');
                        circleEl.setAttribute('stroke-dashoffset', '0');
                        setTimeout(() => removeCountdown(), 50);
                        return;
                    }
                    hoverTimer = requestAnimationFrame(tick);
                };
                const countdownStart = performance.now();
                hoverTimer = requestAnimationFrame(tick);
                const finishRing = () => {
                    done = true;
                    cancelAnimationFrame(hoverTimer);
                    hoverTimer = null;
                    if (countdownEl) {
                        countdownEl.classList.remove('spinning');
                        circleEl.setAttribute('stroke-dashoffset', '0');
                    }
                    setTimeout(() => removeCountdown(), 200);
                };
                setTimeout(() => {
                    if (activeRow !== row) return;
                    fetchStarted = true;
                    countdownEl.classList.add('spinning');
                    const cached = Store.getCachedPoster(id);
                    if (cached && /\/ugc\//.test(cached)) {
                        finishRing();
                        positionFlyout(row);
                        showFlyoutImage(cached);
                        return;
                    }
                    ModFetcher.fetchDetails(id).then(({ poster: imgUrl }) => {
                        if (activeRow !== row) return;
                        finishRing();
                        if (!imgUrl) { Toast.warning('未找到海报图'); return; }
                        positionFlyout(row);
                        showFlyoutImage(imgUrl);
                    }).catch(() => { Toast.warning('加载失败'); finishRing(); });
                }, 1000);
            };
            const positionFlyout = (row) => {
                const modalRect = modal.getBoundingClientRect();
                const midY = modalRect.top + modalRect.height / 2;
                if (lastY < midY) {
                    flyout.style.top = Math.min(modalRect.bottom - 270, window.innerHeight - 280) + 'px';
                    flyout.style.bottom = 'auto';
                } else {
                    flyout.style.top = Math.max(10, modalRect.top + 10) + 'px';
                    flyout.style.bottom = 'auto';
                }
                flyout.style.left = Math.max(4, modalRect.left - 396) + 'px';
                flyout.style.right = 'auto';
                flyout.style.width = '380px';
                flyout.style.height = '260px';
            };
            const showFlyoutImage = (url) => {
                flyout.innerHTML = '';
                const img = document.createElement('img');
                img.src = url;
                img.onerror = () => hideFlyout();
                flyout.appendChild(img);
                flyout.classList.add('show');
            };
            const tbody = modal.querySelector('[data-table-body]');
            if (!tbody) return;
            tbody.addEventListener('mousemove', (e) => {
                if (!this._previewEnabled) return;
                lastX = e.clientX; lastY = e.clientY;
                const row = e.target.closest(SEL.ROW_BY_ID);
                if (!row) {
                    if (activeRow && activeRow !== row) {
                        activeRow = null;
                        removeCountdown();
                        hideFlyout();
                    }
                    return;
                }
                if (row === activeRow) return;
                removeCountdown();
                hideFlyout();
                activeRow = row;
                const id = row.dataset.id;
                if (id) startCountdown(row, id);
            });
            tbody.addEventListener('mouseleave', () => {
                activeRow = null;
                removeCountdown();
                hideFlyout();
            });
            const backdrop = modal.parentElement;
            if (backdrop && backdrop.classList.contains('ws3-modal-backdrop')) {
                const obs = new MutationObserver(() => {
                    if (!document.documentElement.contains(backdrop)) {
                        removeCountdown();
                        flyout.remove();
                        obs.disconnect();
                    }
                });
                obs.observe(document.documentElement, { childList: true });
            }
        },
    };
    /* 分区 13 · 批量收藏：按页遍历收藏列表，批量收藏模组并支持断点续传 */
    const Collector = {
        start(panel) {
            if (!Extractors.ensurePerPage()) {
                Store.setCollectState({ isCollecting: true });
                return;
            }
            const { totalItems, currentPage, totalPages } = Extractors.getPaginationInfo();
            if (!totalItems) {
                Panel.log(panel, '无法获取模组总数，请确认页面已加载完成', 'error');
                return;
            }
            if (currentPage !== 1) {
                Store.setCollectState({ isCollecting: true });
                Panel.log(panel, '正在跳转到第一页...', 'info');
                Extractors.gotoPage(1);
                return;
            }
            Store.setCollectState({ isCollecting: true });
            this._collect(panel);
        },
        _collect(panel) {
            const state = Store.getCollectState();
            if (!state.isCollecting) return;
            const { totalItems, currentPage, totalPages } = Extractors.getPaginationInfo();
            const cards = Extractors.extractWorkshopCards();
            const pageItems = {};
            cards.forEach(c => {
                if (!c.id) return;
                pageItems[c.id] = c.name || '未知名称';
                if (c.poster) Store.setCachedPoster(c.id, c.poster);
                if (c.appid && c.gameName) Store.saveGameName(c.appid, c.gameName);
            });
            const added = Store.addItemsSync(pageItems);
            const items = Store.loadItems();
            const collected = Object.keys(items).length;
            if (added > 0) {
                cards.forEach(c => { if (c.id) Extractors.captureItemToStore(c.id); });
            }
            Panel.log(panel, `第 ${currentPage}/${totalPages} 页 | 新增 ${added} | 累计 ${collected}/${totalItems}`, added ? 'success' : 'info');
            Panel.updateProgress(panel, collected, totalItems, currentPage, totalPages);
            Store.setCollectState({
                totalItems,
                currentPage,
                totalPages,
                lastPage: currentPage
            });
            if (currentPage < totalPages) {
                Store.setCollectState({ isCollecting: true });
                Panel.log(panel, `→ 跳转第 ${currentPage + 1} 页`, 'info');
                Extractors.gotoPage(currentPage + 1);
            } else {
                Store.clearCollectState();
                Panel.log(panel, `✅ 收集完成！共 ${collected} 个模组`, 'success');
                Toast.success(`收集完成，共 ${collected} 个模组`);
                Panel.setButtonDisabled(panel, '#ws3-collect-btn', false);
            }
        },
        resume(panel) {
            const state = Store.getCollectState();
            if (state.isCollecting) {
                Panel.log(panel, '检测到未完成的收集任务，继续...', 'warning');
                this._collect(panel);
            }
        }
    };
    /* 分区 14 · 页面面板构建：按页面类型构建对应面板并注入首页/浏览页三按钮、合集浏览页按钮、合集页按钮 */
    function syncInjectedButtonStates() {
        document.querySelectorAll('.ws3-hover-overlay[data-ws3-id]').forEach(overlay => {
            const id = overlay.dataset.ws3Id;
            if (!id) return;
            if (overlay.classList.contains('ws3-hover-collection')) {
                const btn = overlay.querySelector('[data-action="subscribe-collection"]');
                if (!btn) return;
                if (Store.hasCollection(id)) {
                    btn.classList.add(CLS.ADDED); btn.innerHTML = '✓ 已收藏合集'; btn.title = '已收藏合集';
                } else {
                    btn.classList.remove(CLS.ADDED); btn.innerHTML = '★ 收藏合集'; btn.title = '收藏合集';
                }
            } else {
                const btn = overlay.querySelector('[data-action="subscribe"]');
                if (!btn) return;
                if (Store.hasItem(id)) {
                    btn.classList.add(CLS.ADDED); btn.innerHTML = ICONS.check; btn.title = '已添加到收藏夹';
                } else {
                    btn.classList.remove(CLS.ADDED); btn.innerHTML = ICONS.collect; btn.title = '收藏夹';
                }
            }
        });
        document.querySelectorAll('.ws3-collect-inline.ws3-coll-add[data-ws3-id]').forEach(btn => {
            const id = btn.dataset.ws3Id;
            if (!id) return;
            if (Store.hasItem(id)) {
                btn.classList.add(CLS.ADDED); btn.innerHTML = ICONS.check; btn.title = '已添加到收藏夹';
            } else {
                btn.classList.remove(CLS.ADDED); btn.innerHTML = ICONS.collect; btn.title = '添加到收藏夹';
            }
        });
    }
    let _storeSyncStarted = false;
    function registerStoreSync() {
        if (_storeSyncStarted) return;
        _storeSyncStarted = true;
        Store.onChange(syncInjectedButtonStates);
        syncInjectedButtonStates();
    }
    function injectPageButtons() {
        const type = PageDetector.getType();
        if (type !== 'workshop' && type !== 'collectionBrowse' && type !== 'workshopitem') return;
        const injected = new WeakSet();
        function extractInfo(container) {
            let id = null;
            let name = '未知名称';
            let poster = '';
            const link = container.querySelector(SEL.FILE_DETAILS_LINK) ||
                container.closest(SEL.FILE_DETAILS_LINK);
            if (link && link.href) {
                const m = link.href.match(/[?&]id=(\d+)/);
                if (m) id = m[1];
                const img = container.querySelector('img[alt]') || container.querySelector('img');
                if (img) {
                    if (img.alt.trim().length > 1) name = img.alt.trim();
                    else if (link.textContent.trim()) name = link.textContent.trim();
                    if (img.src) poster = img.src.replace(/&amp;/g, '&');
                } else if (link.textContent.trim()) {
                    name = link.textContent.trim();
                }
            }
            if (id && (!name || name === '未知名称')) {
                const cardEl = container.closest('.workshopItem, .workshopItemSubscription, [id^="sharedfile_"]');
                const titleEl = (cardEl || container).querySelector(SEL.WORKSHOP_ITEM_TITLE);
                if (titleEl && titleEl.textContent.trim()) name = titleEl.textContent.trim();
            }
            if (id && (!name || name === '未知名称')) {
                const c = HoverCardExtractor.get(id);
                if (c && c.name) name = c.name;
            }
            return { id, name, poster };
        }
        function attach() {
            const _type = PageDetector.getType();
            if (_type !== 'workshop' && _type !== 'collectionBrowse' && _type !== 'workshopitem') return;
            function bindHover(container, overlay) {
                let hideTimer = null;
                const show = () => {
                    clearTimeout(hideTimer);
                    overlay.style.display = 'flex';
                    overlay.style.opacity = '1';
                    overlay.style.visibility = 'visible';
                    overlay.style.pointerEvents = 'auto';
                };
                const hide = () => {
                    hideTimer = setTimeout(() => {
                        overlay.style.display = 'none';
                        overlay.style.opacity = '0';
                        overlay.style.visibility = 'hidden';
                        overlay.style.pointerEvents = 'none';
                    }, 50);
                };
                container.addEventListener('mouseenter', show);
                container.addEventListener('mouseleave', hide);
            }
            const sel = (_type === 'workshopitem') ? '.workshopItemPreviewHolder' : '._68RUj0Pwr4Q-._4QZPaDoCaZQ-';
            document.querySelectorAll(sel).forEach(container => {
                if (injected.has(container)) return;
                const { id, name, poster } = extractInfo(container);
                if (!id) return;
                injected.add(container);
                container.style.position = 'relative';
                container.classList.add('ws3-poster-container');
                const overlay = document.createElement('div');
                overlay.className = 'ws3-hover-overlay';
                if (_type === 'collectionBrowse') {
                    overlay.classList.add('ws3-hover-collection');
                    overlay.dataset.ws3Id = id;
                    overlay.innerHTML = `<button class="ws3-hover-btn ws3-hov-collect" data-action="subscribe-collection" title="收藏合集">★ 收藏合集</button>`;
                    const btn = overlay.querySelector('[data-action="subscribe-collection"]');
                    if (Store.hasCollection(id)) { btn.classList.add(CLS.ADDED); btn.innerHTML = '✓ 已收藏合集'; btn.title = '已收藏合集'; }
                    overlay.addEventListener('click', (e) => {
                        e.preventDefault(); e.stopPropagation();
                        const added = Store.addCollectionsSync({ [id]: name });
                        if (poster) Store.setCachedCollectionPoster(id, poster);
                        if (added > 0) {
                            Toast.success('已收藏合集');
                            btn.classList.add(CLS.ADDED); btn.innerHTML = '✓ 已收藏合集'; btn.title = '已收藏合集';
                        } else {
                            Toast.warning('该合集已在收藏列表中');
                            btn.classList.add(CLS.ADDED); btn.innerHTML = '✓ 已在列表';
                        }
                    });
                } else {
                    overlay.dataset.ws3Id = id;
                    overlay.dataset.ws3Name = name;
                    overlay.innerHTML = `
                        <button class="ws3-hover-btn ws3-hov-copy" data-action="copy-id" title="复制 ID">${ICONS.copy}</button>
                        <button class="ws3-hover-btn ws3-hov-cmd" data-action="copy-cmd" title="复制 SteamCMD">${ICONS.cmd}</button>
                        <button class="ws3-hover-btn ws3-hov-sub" data-action="subscribe" title="收藏夹">${ICONS.collect}</button>
                    `;
                    const subBtn = overlay.querySelector('[data-action="subscribe"]');
                    if (Store.hasItem(id)) { subBtn.classList.add(CLS.ADDED); subBtn.innerHTML = ICONS.check; subBtn.title = '已添加到收藏夹'; }
                    overlay.addEventListener('click', (e) => {
                        e.preventDefault(); e.stopPropagation();
                        const btn = e.target.closest(SEL.DATA_ACTION);
                        if (!btn) return;
                        const action = btn.dataset.action;
                        const modId = overlay.dataset.ws3Id;
                        const modName = overlay.dataset.ws3Name;
                        if (action === 'copy-id') {
                            Utils.copyWithToast(modId, `已复制 ID: ${modId}`);
                        } else if (action === 'copy-cmd') {
                            Utils.copyWithToast(PageDetector.getSteamCmd(modId), '已复制 SteamCMD 命令');
                        } else if (action === 'subscribe') {
                        const added = Store.addItemsSync({ [modId]: modName });
                        if (poster) Store.setCachedPoster(modId, poster);
                        HoverCardExtractor.commitToItems(modId);
                            if (added > 0) {
                                Toast.success(`已添加「${modName}」到收藏夹`);
                                btn.classList.add(CLS.ADDED); btn.innerHTML = ICONS.check; btn.title = '已添加到收藏夹';
                            } else {
                                Toast.warning('该模组已在收藏夹中');
                                btn.classList.add(CLS.ADDED); btn.innerHTML = ICONS.check; btn.title = '已添加';
                            }
                        }
                    });
                }
                overlay.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
                const w = container.getBoundingClientRect().width;
                const scale = Math.max(0.55, Math.min(1.3, w / 320));
                overlay.style.setProperty('--ws3-btn-scale', scale.toFixed(3));
                bindHover(container, overlay);
                container.appendChild(overlay);
            });
        }
        if (!injectPageButtons._started) {
            injectPageButtons._started = true;
            const obs = new MutationObserver(Utils.debounce(attach, 300));
            obs.observe(document.body, { childList: true, subtree: true });
            setInterval(() => { if (!document.hidden) attach(); }, 2000);
        }
        registerStoreSync();
        attach();
    }
    function setWorkshopItemPageSize() {
        const hasMultiPage = document.querySelector('a[href*="p=2"], a[href*="&p=2"], .workshopPagination, .paginationBlock, [class*="pagination"]');
        if (!hasMultiPage) return;
        const url = new URL(window.location.href);
        const current = parseInt(url.searchParams.get('numperpage') || '0', 10);
        if (current >= CFG.TARGET_PER_PAGE) return;
        url.searchParams.set('numperpage', String(CFG.TARGET_PER_PAGE));
        url.searchParams.delete('p');
        window.location.href = url.toString();
    }
    function injectCollectionItemButtons() {
        const injected = new WeakSet();
        if (typeof PageDetector !== 'undefined' && PageDetector.invalidate) PageDetector.invalidate();
        const onCollectionPage = PageDetector.getType() === 'collectionBrowse' || PageDetector.getType() === 'collection';
        function makeBtn(innerHTML, title, cls, handler) {
            const btn = document.createElement('a');
            btn.className = cls;
            btn.href = 'javascript:void(0)';
            btn.innerHTML = innerHTML;
            btn.title = title;
            btn.onclick = handler;
            return btn;
        }
        function attach() {
            if (typeof PageDetector !== 'undefined' && PageDetector.invalidate) PageDetector.invalidate();
            const _onCollectionPage = PageDetector.getType() === 'collectionBrowse' || PageDetector.getType() === 'collection';
            if (_onCollectionPage) return;
            document.querySelectorAll('a[onclick*="SubscribeCollectionItem"]').forEach(btn => {
                if (injected.has(btn)) return;
                const onclick = btn.getAttribute('onclick') || '';
                const idMatch = onclick.match(/SubscribeCollectionItem\s*\(\s*'(\d+)'/);
                if (!idMatch) return;
                const modId = idMatch[1];
                const card = btn.closest('.collectionItem, [id^="sharedfile_"]');
                let modName = '未知名称';
                if (card) {
                    const titleEl = card.querySelector(SEL.WORKSHOP_ITEM_TITLE);
                    if (titleEl) modName = titleEl.textContent.trim();
                }
                if (onCollectionPage) {
                    const addBtn = makeBtn(ICONS.collect, `添加「${modName}」到收藏夹`, 'ws3-collect-inline ws3-coll-add',
                        (e) => {
                            e.preventDefault(); e.stopPropagation();
                            const added = Store.addItemsSync({ [modId]: modName });
                            if (added > 0) {
                                Toast.success(`已添加「${modName}」到收藏夹`);
                                addBtn.classList.add(CLS.ADDED);
                                addBtn.innerHTML = ICONS.check;
                                addBtn.title = '已添加到收藏夹';
                            } else {
                                Toast.warning('该模组已在收藏夹中');
                            }
                        });
                    if (Store.hasItem(modId)) {
                        addBtn.classList.add(CLS.ADDED);
                        addBtn.innerHTML = ICONS.check;
                        addBtn.title = '已添加到收藏夹';
                    }
                    btn.parentNode.insertBefore(addBtn, btn);
                } else {
                    const copyBtn = makeBtn(ICONS.copy, `复制 ID: ${modId}`, 'ws3-collect-inline ws3-coll-copy',
                        (e) => { e.preventDefault(); e.stopPropagation(); Utils.copyWithToast(modId, `已复制 ID: ${modId}`); });
                    const cmdBtn = makeBtn(ICONS.cmd, `复制 SteamCMD: ${modId}`, 'ws3-collect-inline ws3-coll-cmd',
                        (e) => { e.preventDefault(); e.stopPropagation(); Utils.copyWithToast(PageDetector.getSteamCmd(modId), '已复制 SteamCMD 命令'); });
                    const addBtn = makeBtn(ICONS.collect, `添加「${modName}」到收藏夹`, 'ws3-collect-inline ws3-coll-add',
                        (e) => {
                            e.preventDefault(); e.stopPropagation();
                            const added = Store.addItemsSync({ [modId]: modName });
                            if (added > 0) {
                                Toast.success(`已添加「${modName}」到收藏夹`);
                                addBtn.classList.add(CLS.ADDED);
                                addBtn.innerHTML = ICONS.check;
                                addBtn.title = '已添加到收藏夹';
                            } else {
                                Toast.warning('该模组已在收藏夹中');
                            }
                        });
                    addBtn.dataset.ws3Id = modId;
                    if (Store.hasItem(modId)) {
                        addBtn.classList.add(CLS.ADDED);
                        addBtn.innerHTML = ICONS.check;
                        addBtn.title = '已添加到收藏夹';
                    }
                    btn.parentNode.insertBefore(addBtn, btn);
                    btn.parentNode.insertBefore(cmdBtn, btn);
                    btn.parentNode.insertBefore(copyBtn, btn);
                }
                injected.add(btn);
            });
        }
        attach();
        registerStoreSync();
        const obs = new MutationObserver(Utils.debounce(attach, 300));
        obs.observe(document.body, { childList: true, subtree: true });
    }
    function buildWorkshopItemPanel() {
        CFG.setApp(PageDetector.getAppId() || '0');
        const panel = Panel.create({
            title: 'Steam 创意工坊工具 · 收藏管理',
            icon: '📦',
            contentFn: () => `
                <div class="ws3-panel-stats">
                    <div class="ws3-panel-stat">
                        <span>📦 收藏夹</span>
                        <span data-stat="gamename" style="font-size:10px;color:var(--ws3-text-muted);margin-left:4px;"></span>
                        <span class="ws3-panel-stat-value" data-stat="collector">0 个</span>
                    </div>
                    <div class="ws3-panel-stat">
                        <span>📋 页面模组</span>
                        <span class="ws3-panel-stat-value" data-stat="page">检测中...</span>
                    </div>
                </div>
                <div class="ws3-panel-progress" data-progress>
                    <div class="ws3-panel-progress-bar">
                        <div class="ws3-panel-progress-fill" style="width:0%"></div>
                    </div>
                    <div class="ws3-panel-progress-text" data-progress-text>点击「开始收集所有」启动</div>
                </div>
                <div class="ws3-panel-actions">
                    <button class="ws3-btn ws3-btn-success" id="ws3-collect-btn">🚀 开始收集所有</button>
                    <button class="ws3-btn ws3-btn-purple" id="ws3-list-btn">📋 已收藏列表</button>
                </div>
                <div class="ws3-panel-actions">
                    <button class="ws3-btn ws3-btn-primary ws3-btn-sm" id="ws3-copy-page-ids">📋 复制页面 ID</button>
                    <button class="ws3-btn ws3-btn-primary ws3-btn-sm" id="ws3-copy-page-cmd">⚙️ 复制页面 CMD</button>
                </div>
                <div class="ws3-panel-log"></div>
            `,
            onInit: (panel) => {
                panel.querySelector('#ws3-collect-btn').onclick = () => Collector.start(panel);
                panel.querySelector(SEL.LIST_BTN).onclick = () => ListManager.show();
                panel.querySelector('#ws3-copy-page-ids').onclick = () => {
                    Utils.copyPageEntries(() => Extractors.extractWorkshopItemEntries(), { emptyMsg: '当前页面未检测到模组' });
                };
                panel.querySelector('#ws3-copy-page-cmd').onclick = () => {
                    Utils.copyPageEntries(() => Extractors.extractWorkshopItemEntries(), { asCmd: true, emptyMsg: '当前页面未检测到模组' });
                };
                const updateWorkshopItemStats = () => {
                    const pageInfo = Extractors.getPaginationInfo();
                    const collectorCount = Store.getCount();
                    const collectorEl = panel.querySelector('[data-stat="collector"]');
                    const pageEl = panel.querySelector('[data-stat="page"]');
                    if (collectorEl) collectorEl.textContent = `${collectorCount} 个`;
                    const gameEl = panel.querySelector('[data-stat="gamename"]');
                    if (gameEl) {
                        const aid = PageDetector.getAppId();
                        gameEl.textContent = aid ? '(' + aid + ')' : '';
                    }
                    if (pageEl) {
                        if (pageInfo.totalItems > 0) {
                            const pagesInfo = pageInfo.totalPages > 1 ? ` · ${pageInfo.totalPages} 页` : '';
                            pageEl.textContent = `${pageInfo.totalItems} 个${pagesInfo}`;
                        } else {
                            pageEl.textContent = '检测中...';
                        }
                    }
                };
                updateWorkshopItemStats();
                Store.onChange(() => updateWorkshopItemStats());
                Panel.log(panel, '页面就绪 | AppID: ' + (PageDetector.getAppId() || '未检测到'), 'info');
                const state = Store.getCollectState();
                if (state.isCollecting) {
                    Collector.resume(panel);
                }
            }
        });
        setWorkshopItemPageSize();
        waitForWorkshopItems(() => {
            const collectorEl = panel.querySelector('[data-stat="collector"]');
            const pageEl = panel.querySelector('[data-stat="page"]');
            if (collectorEl) collectorEl.textContent = `${Store.getCount()} 个`;
            if (pageEl) {
                const pageInfo = Extractors.getPaginationInfo();
                if (pageInfo.totalItems > 0) {
                    const pagesInfo = pageInfo.totalPages > 1 ? ` · ${pageInfo.totalPages} 页` : '';
                    pageEl.textContent = `${pageInfo.totalItems} 个${pagesInfo}`;
                }
            }
        });
    }
    function buildCollectionPanel() {
        const idsObj = Extractors.extractCollectionItems();
        const collId = new URLSearchParams(window.location.search).get('id') || '';
        const collName = document.querySelector(SEL.WORKSHOP_ITEM_TITLE)?.textContent?.trim() || '未知合集';
        const panel = Panel.create({
            title: 'Steam 创意工坊工具 · 合集提取',
            icon: '📚',
            contentFn: () => `
                <div class="ws3-panel-stat">
                    <span>📦 合集模组数</span>
                    <span class="ws3-panel-stat-value">${Object.keys(idsObj).length} 个</span>
                </div>
                <div class="ws3-panel-actions">
                    <button class="ws3-btn ws3-btn-success" id="ws3-add-all-btn">⭐ 收藏全部模组</button>
                    <button class="ws3-btn ws3-btn-accent" id="ws3-collect-coll-btn">📚 收藏合集</button>
                </div>
                <div class="ws3-panel-actions">
                    <button class="ws3-btn ws3-btn-primary" id="ws3-copy-ids-btn">📋 复制全部 ID</button>
                    <button class="ws3-btn ws3-btn-primary" id="ws3-copy-cmd-btn">⚙️ 复制全部 CMD</button>
                </div>
                <div class="ws3-panel-actions">
                    <button class="ws3-btn ws3-btn-purple" id="ws3-list-btn">📋 已收藏列表</button>
                </div>
                <div class="ws3-panel-log"></div>
            `,
            onInit: (panel) => {
                injectCollectionItemButtons();
                panel.querySelector('#ws3-add-all-btn').onclick = () => {
                    const items = Extractors.extractCollectionItems();
                    const added = Store.addItemsSync(items);
                    Toast.success(added > 0 ? `已添加 ${added} 个模组到收藏夹` : '没有新模组可添加');
                    if (added) {
                        Panel.log(panel, `添加了 ${added} 个新模组`, 'success');
                        Object.keys(items).forEach(id => Extractors.captureItemToStore(id));
                    }
                };
                panel.querySelector('#ws3-copy-ids-btn').onclick = () => {
                    Utils.copyPageEntries(() => Extractors.extractCollectionItems(), { emptyMsg: '未检测到模组' });
                };
                panel.querySelector('#ws3-copy-cmd-btn').onclick = () => {
                    Utils.copyPageEntries(() => Extractors.extractCollectionItems(), { asCmd: true, emptyMsg: '未检测到模组' });
                };
                panel.querySelector(SEL.LIST_BTN).onclick = () => ListManager.show();
                panel.querySelector('#ws3-collect-coll-btn').onclick = () => {
                    if (!collId) { Toast.warning('未检测到合集 ID'); return; }
                    const added = Store.addCollectionsSync({ [collId]: collName });
                    Extractors.captureCollectionToStore(collId);
                    if (added > 0) {
                        Toast.success(`已收藏合集「${collName}」`);
                        Panel.log(panel, `收藏合集: ${collName} (ID: ${collId})`, 'success');
                    } else {
                        Toast.warning('该合集已在收藏列表中');
                    }
                };
                if (collId && Store.hasCollection(collId)) {
                    panel.querySelector('#ws3-collect-coll-btn').textContent = '📚 已收藏合集';
                    panel.querySelector('#ws3-collect-coll-btn').classList.add(CLS.ADDED);
                }
                Store.onChange(() => {
                    const el = panel.querySelector('.ws3-panel-stat-value');
                    if (el) el.textContent = `${Object.keys(Extractors.extractCollectionItems()).length} 个`;
                });
                Panel.log(panel, '合集提取就绪 | AppID: ' + (PageDetector.getAppId() || '未检测到'), 'success');
            }
        });
    }
    function buildItemPanel() {
        const itemId = Extractors.getSingleItemId();
        const itemTitle = Extractors.getSingleItemTitle();
        Panel.create({
            title: 'Steam 创意工坊工具 · 模组详情',
            icon: '📌',
            contentFn: () => `
                <div class="ws3-panel-stat">
                    <span>📌 当前模组</span>
                    <span class="ws3-panel-stat-value" style="font-size:13px;">${Utils.escapeHtml(itemTitle)}</span>
                </div>
                <div class="ws3-panel-stat">
                    <span>🆔 模组 ID</span>
                    <span class="ws3-panel-stat-value" style="font-family:var(--ws3-font-mono);font-size:14px;">${Utils.escapeHtml(itemId || '未找到')}</span>
                </div>
                <div class="ws3-panel-actions">
                    <button class="${itemId && Store.hasItem(itemId) ? 'ws3-btn ws3-btn-added' : 'ws3-btn ws3-btn-success'}" id="ws3-add-btn">${itemId && Store.hasItem(itemId) ? '✓ 已收藏' : '⭐ 添加到收藏夹'}</button>
                    <button class="ws3-btn ws3-btn-primary" id="ws3-copy-id-btn">📋 复制 ID</button>
                </div>
                <div class="ws3-panel-actions">
                    <button class="ws3-btn ws3-btn-primary" id="ws3-copy-cmd-btn">⚙️ 复制 SteamCMD</button>
                    <button class="ws3-btn ws3-btn-purple" id="ws3-list-btn">📋 已收藏列表</button>
                </div>
                <div class="ws3-panel-log"></div>
            `,
            onInit: (panel) => {
                panel.querySelector('#ws3-add-btn').onclick = () => {
                    if (!itemId) return Toast.error('无法获取模组 ID');
                    const added = Store.addItemsSync({ [itemId]: itemTitle });
                    Extractors.captureItemToStore(itemId);
                    if (added > 0) {
                        Toast.success(`已添加「${itemTitle}」到收藏夹`);
                        Panel.log(panel, `添加模组 ${itemId}`, 'success');
                        const b = panel.querySelector('#ws3-add-btn');
                        b.className = 'ws3-btn ws3-btn-added';
                        b.textContent = '✓ 已收藏';
                        b.title = '已添加到收藏夹';
                    } else {
                        Toast.warning('该模组已在收藏夹中');
                    }
                };
                panel.querySelector('#ws3-copy-id-btn').onclick = () => {
                    if (!itemId) return Toast.warning('未找到 ID');
                    Utils.copyWithToast(itemId, '已复制 ID: ' + itemId);
                };
                panel.querySelector('#ws3-copy-cmd-btn').onclick = () => {
                    if (!itemId) return Toast.warning('未找到 ID');
                    Utils.copyWithToast(PageDetector.getSteamCmd(itemId), '已复制 SteamCMD 命令');
                };
                panel.querySelector(SEL.LIST_BTN).onclick = () => ListManager.show();
                Store.onChange(() => {
                    const el = panel.querySelector('.ws3-panel-stat-value');
                    if (el) el.textContent = `${Store.getCount()} 个`;
                });
                Panel.log(panel, `模组 ID: ${itemId} | AppID: ${PageDetector.getAppId() || '未检测到'}`, 'info');
            }
        });
    }
    function buildGenericWorkshopPanel() {
        Panel.create({
            title: 'Steam 创意工坊工具 · 工坊浏览',
            icon: '🛠️',
            position: 'bottom-left',
            contentFn: () => `
                <div class="ws3-panel-stat">
                    <span>📦 收藏夹</span>
                    <span class="ws3-panel-stat-value" data-stat="collector">${Store.getCount()} 个</span>
                </div>
                <div style="color:var(--ws3-text-secondary);font-size:12px;margin-bottom:12px;">
                    AppID: ${PageDetector.getAppId() || '未检测到'}
                </div>
                <div class="ws3-panel-actions">
                    <button class="ws3-btn ws3-btn-purple" id="ws3-list-btn">📋 已收藏列表</button>
                </div>
                <div class="ws3-panel-actions">
                    <button class="ws3-btn ws3-btn-primary ws3-btn-sm" id="ws3-copy-page-ids">📋 复制页面 ID</button>
                    <button class="ws3-btn ws3-btn-primary ws3-btn-sm" id="ws3-copy-page-cmd">⚙️ 复制页面 CMD</button>
                </div>
                <div class="ws3-panel-log"></div>
            `,
            onInit: (panel) => {
                panel.querySelector(SEL.LIST_BTN).onclick = () => ListManager.show();
                panel.querySelector('#ws3-copy-page-ids').onclick = () => {
                    Utils.copyPageEntries(() => Extractors.extractWorkshopItemEntries(), { emptyMsg: '当前页面未检测到模组卡片' });
                };
                panel.querySelector('#ws3-copy-page-cmd').onclick = () => {
                    Utils.copyPageEntries(() => Extractors.extractWorkshopItemEntries(), { asCmd: true, emptyMsg: '当前页面未检测到模组卡片' });
                };
                Store.onChange(() => {
                    const el = panel.querySelector('[data-stat="collector"]');
                    if (el) el.textContent = `${Store.getCount()} 个`;
                });
                const stored = Store.getCount();
                Panel.log(panel, `已存储 ${stored} 个模组 | AppID: ${PageDetector.getAppId() || '未检测到'}`, 'info');
            }
        });
    }
    function waitForWorkshopItems(callback, timeout = CFG.OBSERVER_TIMEOUT) {
        const selectors = [
            SEL.WORKSHOP_ITEM,
            '[id^="Subscription"]',
            '[id^="Unsubscribed"]',
            '[id^="sharedfile_"]',
            SEL.WORKSHOP_ITEM_PREVIEW
        ];
        if (selectors.some(s => document.querySelector(s))) {
            callback();
            return;
        }
        let observer = null;
        const timer = setTimeout(() => {
            if (observer) observer.disconnect();
            callback();
        }, timeout);
        observer = new MutationObserver((_mutations, obs) => {
            if (selectors.some(s => document.querySelector(s))) {
                clearTimeout(timer);
                obs.disconnect();
                callback();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }
    const PagePanelController = {
        current: null,
        type: null,
        set(panel, type) { this.current = panel; this.type = type; },
        replace(type) {
            if (this.current && document.documentElement.contains(this.current)) {
                this.current.style.display = 'none';
                if (this.current._removeResize) this.current._removeResize();
                if (this.current._removeDragListeners) this.current._removeDragListeners();
                this.current.remove();
            }
            this.current = null;
            this.type = type;
            const panel = buildPagePanel(type);
            if (panel) { this.current = panel; this.type = type; }
        }
    };
    function buildPagePanel(type) {
        switch (type) {
            case 'workshopitem': return buildWorkshopItemPanel();
            case 'collection': return buildCollectionPanel();
            case 'item': return buildItemPanel();
            case 'workshop':
            case 'collectionBrowse': return buildGenericWorkshopPanel();
            case 'unknown':
                if (PageDetector.isWorkshopPage()) return buildGenericWorkshopPanel();
                return null;
            default: return null;
        }
    }
    /* 分区 16 · 启动入口：按页面类型初始化各模块，并在 DOM 就绪后启动脚本 */
    function init() {
        const pageType = PageDetector.getType();
        CFG.setApp(PageDetector.getAppId() || '0');
        HoverCardExtractor.init();
        injectPageButtons();
        PageDetector.watchUrl((newType) => {
            injectPageButtons();
            if (newType !== PagePanelController.type) {
                PagePanelController.replace(newType);
            }
        });
        const panel = buildPagePanel(pageType);
        PagePanelController.set(panel, pageType);
        const appId = PageDetector.getAppId();
        if (appId) {
            console.log(`[Steam Workshop Tool v3.0] 页面类型: ${pageType} | AppID: ${appId} | 已存储: ${Store.getCount()} 个模组`);
        } else {
            console.log(`[Steam Workshop Tool v3.0] 页面类型: ${pageType} | 已存储: ${Store.getCount()} 个模组`);
        }
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();