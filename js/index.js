import AuraNotify from "/js/AuraNotify.js";

let keyframePreview = null;
let currentPreviewStreamer = null;

// IndexedDB 缓存管理类
class StatusCache {
    constructor(dbName = 'StatusCache', storeName = 'monitors') {
        this.dbName = dbName;
        this.storeName = storeName;
        this.db = null;
        this.CACHE_KEY = 'system_monitors';
        this.CACHE_DURATION = 5 * 60 * 1000; // 5分钟缓存
    }

    // 初始化数据库
    async init() {
        if (this.db) return this.db;

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 1);

            request.onerror = () => {
                console.error('IndexedDB 打开失败');
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    // 创建对象仓库，使用时间戳作为索引
                    const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
                    store.createIndex('timestamp', 'timestamp', { unique: false });
                }
            };
        });
    }

    // 保存数据到缓存
    async set(data) {
        try {
            await this.init();
            
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            
            const cacheItem = {
                id: this.CACHE_KEY,
                data: data,
                timestamp: Date.now()
            };
            
            return new Promise((resolve, reject) => {
                const request = store.put(cacheItem);
                request.onsuccess = () => resolve(true);
                request.onerror = () => reject(request.error);
            });
        } catch (err) {
            console.error('缓存保存失败:', err);
            return false;
        }
    }

    // 获取缓存数据
    async get() {
        try {
            await this.init();
            
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            
            return new Promise((resolve) => {
                const request = store.get(this.CACHE_KEY);
                
                request.onsuccess = () => {
                    const cacheItem = request.result;
                    
                    // 检查缓存是否存在且未过期
                    if (cacheItem && cacheItem.data) {
                        const age = Date.now() - cacheItem.timestamp;
                        if (age < this.CACHE_DURATION) {
                            console.log(`使用缓存数据 (${Math.round(age/1000)}秒前)`);
                            resolve(cacheItem.data);
                        } else {
                            console.log('缓存已过期');
                            resolve(null);
                        }
                    } else {
                        resolve(null);
                    }
                };
                
                request.onerror = () => {
                    console.error('缓存读取失败');
                    resolve(null);
                };
            });
        } catch (err) {
            console.error('缓存读取失败:', err);
            return null;
        }
    }

    // 清除过期缓存（可选）
    async clearExpired() {
        try {
            await this.init();
            
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const index = store.index('timestamp');
            
            const now = Date.now();
            const expiryTime = now - this.CACHE_DURATION;
            
            const range = IDBKeyRange.upperBound(expiryTime);
            
            return new Promise((resolve) => {
                const request = index.openCursor(range);
                
                request.onsuccess = (event) => {
                    const cursor = event.target.result;
                    if (cursor) {
                        store.delete(cursor.primaryKey);
                        cursor.continue();
                    } else {
                        resolve(true);
                    }
                };
                
                request.onerror = () => resolve(false);
            });
        } catch (err) {
            console.error('清除过期缓存失败:', err);
            return false;
        }
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const $container = document.querySelector('.streamers-container');
    const $search = document.getElementById('search');
    const $statusFilter = document.getElementById('status-filter');
    const $sortOrder = document.getElementById('sort-order');
    const $statusDot = document.querySelector('.status-dot');
    const $statusText = document.querySelector('.status-text');
    const $totalCount = document.getElementById('total-count');
    const $liveCount = document.getElementById('live-count');
    const $offlineCount = document.getElementById('offline-count');
    const $lastUpdate = document.getElementById('last-update');

    // 系统状态相关的DOM元素
    const $systemContainer = document.getElementById('system-status-container');
    const $systemTotal = document.getElementById('system-total');
    const $systemUp = document.getElementById('system-up');
    const $systemDown = document.getElementById('system-down');

    let streamers = [];
    let systemMonitors = [];
    let isRefreshing = false;
    const Notify = new AuraNotify();
    
    // 初始化缓存
    const statusCache = new StatusCache();
    
    // API请求节流控制
    const API_THROTTLE = {
        lastRequestTime: 0,
        minInterval: 6000, // 6秒最小间隔（每分钟最多10次）
        requestCount: 0,
        resetTime: Date.now() + 60000
    };

    // 排序配置
    const sortOptions = {
        name_asc: { key: "name", order: "asc", text: "名称A-Z" },
        name_desc: { key: "name", order: "desc", text: "名称Z-A" },
        live_desc: { key: "living", order: "desc", text: "直播优先" },
        live_asc: { key: "living", order: "asc", text: "未直播优先" },
    };

    let currentSort = "live_desc";

    // 检查是否可以发送API请求（限流控制）
    function canMakeRequest() {
        const now = Date.now();
        
        // 重置计数器（每分钟）
        if (now >= API_THROTTLE.resetTime) {
            API_THROTTLE.requestCount = 0;
            API_THROTTLE.resetTime = now + 60000;
            API_THROTTLE.lastRequestTime = 0;
            return true;
        }
        
        // 检查是否超过每分钟限制
        if (API_THROTTLE.requestCount >= 10) {
            console.warn('API请求已达到每分钟上限');
            return false;
        }
        
        // 检查请求间隔
        if (now - API_THROTTLE.lastRequestTime < API_THROTTLE.minInterval) {
            console.log('请求间隔太短，稍后再试');
            return false;
        }
        
        return true;
    }

    // 记录API请求
    function recordRequest() {
        API_THROTTLE.lastRequestTime = Date.now();
        API_THROTTLE.requestCount++;
        console.log(`API请求次数: ${API_THROTTLE.requestCount}/10 (重置于 ${new Date(API_THROTTLE.resetTime).toLocaleTimeString()})`);
    }

    // 更新连接状态
    function updateConnectionStatus(status) {
        $statusDot.classList.remove("connected", "disconnected", "loading");

        switch (status) {
            case 1:
                $statusDot.classList.add("connected");
                $statusText.textContent = "数据正常";
                break;
            case 0:
                $statusDot.classList.add("loading");
                $statusText.textContent = "加载中...";
                break;
            case -1:
                $statusDot.classList.add("disconnected");
                $statusText.textContent = "数据异常";
                break;
            default:
                $statusDot.classList.add("disconnected");
                $statusText.textContent = "状态未知";
        }
    }

    // 获取配置数据
    async function loadConfigData() {
        try {
            const response = await fetch(`/data.json?_t=${Date.now()}`);
            if (!response.ok) {
                throw new Error(`加载配置失败: ${response.status}`);
            }
            const config = await response.json();

            if (!Array.isArray(config.mid)) {
                throw new Error('主播UID数据格式错误');
            }
            if (!Array.isArray(config.monitorsid)) {
                throw new Error('系统监控ID数据格式错误');
            }
            if (!config.readonlyuptimerobotapikey) {
                throw new Error('UptimeRobot API密钥不存在');
            }

            const validUids = config.mid.filter(uid => {
                return typeof uid === 'string' && /^\d+$/.test(uid);
            });

            const validMonitorIds = config.monitorsid.filter(id => {
                return typeof id === 'string' && /^\d+$/.test(id);
            });

            console.log(`加载了 ${validUids.length} 个有效UID, ${validMonitorIds.length} 个系统监控ID`);
            
            return {
                mids: validUids,
                monitorIds: validMonitorIds,
                apiKey: config.readonlyuptimerobotapikey
            };
        } catch (err) {
            console.error('加载配置失败:', err);
            Notify.error(`加载配置失败: ${err.message}`, "配置加载");
            return {
                mids: [],
                monitorIds: [],
                apiKey: ''
            };
        }
    }

    // 获取系统监控状态 - 带缓存和限流
    async function fetchSystemStatus(monitorIds, apiKey) {
        if (!monitorIds.length || !apiKey) return [];

        try {
            // 1. 先尝试读取缓存
            const cachedData = await statusCache.get();
            if (cachedData) {
                console.log('使用缓存的系统状态数据');
                return cachedData;
            }

            // 2. 检查限流
            if (!canMakeRequest()) {
                console.warn('API请求被限流，返回空数据');
                Notify.warning('API请求频繁，使用最后缓存', '限流提示');
                return [];
            }

            // 3. 发起API请求
            console.log('发起UptimeRobot API请求...');
            const response = await fetch('https://api.uptimerobot.com/v3/monitors?limit=200', {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                }
            });

            recordRequest(); // 记录这次请求

            if (!response.ok) {
                throw new Error(`API错误: ${response.status}`);
            }

            const { data } = await response.json();
            
            if (Array.isArray(data)) {
                const filteredData = data
                    .filter(m => monitorIds.includes(m.id.toString()))
                    .map(m => ({
                        id: m.id,
                        name: m.friendlyName,
                        url: m.url,
                        status: m.status,
                        type: m.type,
                        interval: m.interval,
                        duration: m.currentStateDuration,
                        createTime: m.createDateTime
                    }));

                // 4. 保存到缓存
                await statusCache.set(filteredData);
                console.log(`获取到 ${filteredData.length} 个系统监控状态并已缓存`);

                return filteredData;
            }
            
            return [];
        } catch (err) {
            console.error('获取系统状态失败:', err);
            
            // 5. 出错时尝试读取缓存（即使过期也读）
            try {
                await statusCache.init();
                const transaction = statusCache.db.transaction([statusCache.storeName], 'readonly');
                const store = transaction.objectStore(statusCache.storeName);
                
                return new Promise((resolve) => {
                    const request = store.get(statusCache.CACHE_KEY);
                    request.onsuccess = () => {
                        if (request.result) {
                            console.log('API失败，使用过期缓存');
                            Notify.warning('使用缓存数据（API暂时不可用）', '降级提示');
                            resolve(request.result.data);
                        } else {
                            resolve([]);
                        }
                    };
                    request.onerror = () => resolve([]);
                });
            } catch (cacheErr) {
                console.error('读取缓存失败:', cacheErr);
                return [];
            }
        }
    }

    // 获取直播状态
    async function fetchLiveStatus(uids) {
        try {
            const response = await fetch('https://api.silvertideproject.top/api/v1/live', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ uids })
            });

            if (!response.ok) {
                throw new Error(`API错误: ${response.status}`);
            }

            const data = await response.json();

            if (data.code === 0 && data.data) {
                return data.data;
            } else {
                throw new Error(data.message || 'API返回数据格式错误');
            }
        } catch (err) {
            console.error('获取直播状态失败:', err);
            Notify.error(`获取直播状态失败: ${err.message}`, "直播状态");
            return {};
        }
    }

    // 渲染系统状态卡片
    function renderSystemStatus(monitors) {
        if (!$systemContainer) return;

        if (!monitors.length) {
            $systemContainer.innerHTML = '<div class="system-card offline">暂无系统监控数据</div>';
            return;
        }

        const statusMap = {
            'UP': { class: 'up', text: '正常', icon: '✅' },
            'DOWN': { class: 'down', text: '故障', icon: '❌' },
            'PAUSED': { class: 'paused', text: '暂停', icon: '⏸️' },
            'MAINTENANCE': { class: 'maintenance', text: '维护', icon: '🔧' }
        };

        const systemHtml = monitors.map(monitor => {
            const status = statusMap[monitor.status] || { class: 'unknown', text: monitor.status, icon: '❓' };
            const duration = monitor.duration;
            const durationText = duration < 60 ? `${duration}秒` :
                                duration < 3600 ? `${Math.floor(duration/60)}分钟` :
                                `${Math.floor(duration/3600)}小时`;

            return `
                <div class="system-card ${status.class}" data-id="${monitor.id}">
                    <div class="system-header">
                        <span class="system-name">${monitor.name}</span>
                        <span class="system-status status-${status.class}">
                            ${status.icon} ${status.text}
                        </span>
                    </div>
                    <div class="system-body">
                        <div class="system-url">
                            <a href="${monitor.url}" target="_blank" rel="noopener noreferrer">
                                ${monitor.url.replace(/^https?:\/\//, '')}
                            </a>
                        </div>
                        <div class="system-stats">
                            <span class="system-stat">
                                <span class="stat-label">类型</span>
                                <span class="stat-value">${monitor.type}</span>
                            </span>
                            <span class="system-stat">
                                <span class="stat-label">间隔</span>
                                <span class="stat-value">${monitor.interval}秒</span>
                            </span>
                            <span class="system-stat">
                                <span class="stat-label">持续</span>
                                <span class="stat-value">${durationText}</span>
                            </span>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        $systemContainer.innerHTML = systemHtml;

        // 更新系统统计
        if ($systemTotal) $systemTotal.textContent = monitors.length;
        if ($systemUp) $systemUp.textContent = monitors.filter(m => m.status === 'UP').length;
        if ($systemDown) $systemDown.textContent = monitors.filter(m => m.status !== 'UP').length;
    }

    // 合并数据获取（带缓存）
    async function fetchData(forceRefresh = false) {
        if (isRefreshing) return;

        isRefreshing = true;
        const $refreshBtn = document.getElementById('refresh-btn');
        $refreshBtn.querySelector("svg").classList.add("refreshing");
        updateConnectionStatus(0);

        try {
            const config = await loadConfigData();

            if (config.mids.length === 0 && config.monitorIds.length === 0) {
                throw new Error('未找到任何监控数据');
            }

            // 如果强制刷新，清除系统状态缓存
            if (forceRefresh) {
                await statusCache.set([]); // 清空缓存
                console.log('强制刷新，已清除缓存');
            }

            // 并行获取直播数据和系统监控数据
            const [liveStatus, systemMonitorsData] = await Promise.all([
                fetchLiveStatus(config.mids),
                fetchSystemStatus(config.monitorIds, config.apiKey)
            ]);

            // 处理直播数据
            streamers = [];
            Object.keys(liveStatus).forEach(uid => {
                const status = liveStatus[uid];
                if (status) {
                    streamers.push({
                        id: parseInt(uid,10),
                        uid: parseInt(uid,10),
                        name: status.uname || `主播_${uid}`,
                        liveStatus: status,
                        living: status.live_status === 1,
                        description: status.description || '',
                        face: status.face || `/noface.jpg`,
                        roomId: status.room_id || 0
                    });
                }
            });

            // 处理系统监控数据
            systemMonitors = systemMonitorsData;

            console.log(`成功获取 ${streamers.length} 个主播状态, ${systemMonitors.length} 个系统状态`);

            // 更新UI
            filterStreamers();
            renderSystemStatus(systemMonitors);
            updateStats();
            updateConnectionStatus(1);

            const now = new Date();
            $lastUpdate.textContent = now.toLocaleString('zh-CN');

            // 显示缓存状态
            const cacheAge = await getCacheAge();
            if (cacheAge > 0) {
                Notify.info(`数据已缓存 (${Math.round(cacheAge/1000)}秒前更新)`, "缓存提示", {
                    duration: 2000
                });
            }

            Notify.success(`数据更新成功 (${streamers.length}位主播, ${systemMonitors.length}个服务)`, "数据更新", {
                duration: 3000
            });
        } catch (err) {
            console.error('获取数据时出错:', err);
            Notify.error(`数据获取失败: ${err.message}`, "数据错误");
            updateConnectionStatus(-1);
        } finally {
            isRefreshing = false;
            $refreshBtn.querySelector("svg").classList.remove("refreshing");
        }
    }

    // 获取缓存年龄（用于显示）
    async function getCacheAge() {
        try {
            await statusCache.init();
            const transaction = statusCache.db.transaction([statusCache.storeName], 'readonly');
            const store = transaction.objectStore(statusCache.storeName);
            
            return new Promise((resolve) => {
                const request = store.get(statusCache.CACHE_KEY);
                request.onsuccess = () => {
                    if (request.result) {
                        resolve(Date.now() - request.result.timestamp);
                    } else {
                        resolve(0);
                    }
                };
                request.onerror = () => resolve(0);
            });
        } catch {
            return 0;
        }
    }

    // 更新统计信息
    function updateStats() {
        const total = streamers.length;
        const liveCount = streamers.filter(s => s.living).length;
        const offlineCount = total - liveCount;

        $totalCount.textContent = total;
        $liveCount.textContent = liveCount;
        $offlineCount.textContent = offlineCount;
    }

    // 排序函数
    function sortStreamers(data) {
        const sorted = [...data];
        const option = sortOptions[currentSort];

        return sorted.sort((a, b) => {
            let aValue = a[option.key];
            let bValue = b[option.key];

            if (option.key === "living") {
                aValue = aValue ? 1 : 0;
                bValue = bValue ? 1 : 0;
            }

            if (typeof aValue === "string") {
                aValue = aValue.toLowerCase();
                bValue = bValue.toLowerCase();
            }

            if (option.order === "asc") {
                return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
            } else {
                return aValue > bValue ? -1 : aValue < bValue ? 1 : 0;
            }
        });
    }

    // 渲染主播卡片
    function renderStreamers(filteredStreamers) {
        try {
            $container.innerHTML = '';

            if (filteredStreamers.length === 0) {
                $container.innerHTML = '<p class="no-results">没有找到匹配的主播</p>';
                return;
            }

            const sortedStreamers = sortStreamers(filteredStreamers);

            sortedStreamers.forEach((streamer) => {
                const card = createStreamerCard(streamer);
                $container.appendChild(card);
            });
        } catch (err) {
            console.error("渲染主播列表时出错:", err);
            Notify.error(`渲染失败: ${err.message}`, "渲染错误");
        }
    }

    // 创建单个主播卡片
    function createStreamerCard(streamer) {
        try {
            const isLiving = streamer.living;
            const statusClass = isLiving ? "living" : "offline";
            const statusText = isLiving ? "直播中" : "未直播";
            const onlineCount = isLiving ? (streamer.liveStatus.online || 0) : 0;

            const areaName = streamer.liveStatus
                ? streamer.liveStatus.area_v2_parent_name && streamer.liveStatus.area_v2_name
                    ? `${streamer.liveStatus.area_v2_parent_name} · ${streamer.liveStatus.area_v2_name}`
                    : streamer.liveStatus.area_name || ""
                : "";

            const card = document.createElement('div');
            card.className = 'streamer-card';
            card.dataset.id = streamer.id;
            card.dataset.name = streamer.name;
            card.dataset.status = statusClass;

            const keyframeUrl = isLiving && streamer.liveStatus.keyframe ? streamer.liveStatus.keyframe : '';

            const header = document.createElement('div');
            header.className = 'streamer-header';
            if (keyframeUrl) {
                header.dataset.keyframe = keyframeUrl;
                header.dataset.living = 'true';
                header.addEventListener('mouseover', (e) => handleStreamerHover(header, e));
                header.addEventListener('mousemove', handleStreamerHoverMove);
                header.addEventListener('mouseout', () => handleStreamerHoverOut(header));
            }

            const avatar = document.createElement('img');
            avatar.className = 'streamer-avatar';
            avatar.src = streamer.face || `/noface.jpg`;
            avatar.alt = streamer.name;
            avatar.referrerPolicy = 'no-referrer';
            avatar.onerror = () => {
                avatar.src = '/noface.jpg';
            };

            const infoDiv = document.createElement('div');
            infoDiv.className = 'streamer-info';

            const nameH3 = document.createElement('h3');
            nameH3.className = 'streamer-name';
            nameH3.textContent = streamer.name;

            const statusSpan = document.createElement('span');
            statusSpan.className = `streamer-status ${statusClass}`;
            statusSpan.textContent = statusText;

            infoDiv.appendChild(nameH3);
            infoDiv.appendChild(statusSpan);

            if (isLiving && onlineCount > 0) {
                const onlineDiv = document.createElement('div');
                onlineDiv.className = 'online-count';
                onlineDiv.innerHTML = `<span class="online-dot"></span> ${formatNumber(onlineCount)}`;
                infoDiv.appendChild(onlineDiv);
            }

            if (areaName) {
                const areaDiv = document.createElement('div');
                areaDiv.className = 'area-info';
                areaDiv.textContent = areaName;
                infoDiv.appendChild(areaDiv);
            }

            header.appendChild(avatar);
            header.appendChild(infoDiv);

            const bodyDiv = document.createElement('div');
            bodyDiv.className = 'streamer-body';

            const titleDiv = document.createElement('div');
            titleDiv.className = 'streamer-title';
            titleDiv.textContent = streamer.liveStatus && streamer.liveStatus.title
                ? streamer.liveStatus.title
                : "暂无标题";
            bodyDiv.appendChild(titleDiv);

            if (streamer.description) {
                const descP = document.createElement('p');
                descP.className = 'streamer-description';
                descP.textContent = streamer.description;
                bodyDiv.appendChild(descP);
            }

            const linksDiv = document.createElement('div');
            linksDiv.className = 'streamer-links';

            const spaceLink = document.createElement('a');
            spaceLink.href = `https://space.bilibili.com/${streamer.uid}`;
            spaceLink.className = 'streamer-link';
            spaceLink.target = '_blank';
            spaceLink.textContent = 'B站主页';
            linksDiv.appendChild(spaceLink);

            const liveLink = document.createElement('a');
            const roomId = streamer.liveStatus ? streamer.liveStatus.room_id : streamer.roomId;
            liveLink.href = `https://live.bilibili.com/${roomId || '1'}`;
            liveLink.className = 'streamer-link';
            liveLink.target = '_blank';
            liveLink.textContent = '直播间';
            linksDiv.appendChild(liveLink);

            bodyDiv.appendChild(linksDiv);

            card.appendChild(header);
            card.appendChild(bodyDiv);

            return card;
        } catch (err) {
            console.error("创建主播卡片时出错:", err);
            return document.createElement('div');
        }
    }

    // 格式化数字
    function formatNumber(num) {
        if (num >= 10000) {
            return (num / 10000).toFixed(1) + "万";
        }
        return num.toString();
    }

    // 过滤主播
    function filterStreamers() {
        try {
            const searchTerm = $search.value.toLowerCase();
            const statusFilter = $statusFilter.value;

            const filtered = streamers.filter((streamer) => {
                const matchesSearch = streamer.name.toLowerCase().includes(searchTerm) ||
                    (streamer.description && streamer.description.toLowerCase().includes(searchTerm));

                const matchesStatus = statusFilter === "all" ||
                    (statusFilter === "living" && streamer.living) ||
                    (statusFilter === "offline" && !streamer.living);

                return matchesSearch && matchesStatus;
            });

            renderStreamers(filtered);
        } catch (err) {
            console.error("过滤主播时出错:", err);
            Notify.error(`筛选失败: ${err.message}`, "筛选错误");
        }
    }

    // 关键帧预览相关函数
    function createKeyframePreview() {
        if (!keyframePreview) {
            keyframePreview = document.createElement("div");
            keyframePreview.className = "keyframe-preview";
            keyframePreview.innerHTML = '<img src="" alt="直播预览" referrerpolicy="no-referrer"><span class="preview-label">直播画面预览</span>';
            document.body.appendChild(keyframePreview);
        }
        return keyframePreview;
    }

    function handleStreamerHover(element, event) {
        const isLiving = element.getAttribute("data-living") === "true";
        const keyframeUrl = element.getAttribute("data-keyframe");

        if (isLiving && keyframeUrl) {
            currentPreviewStreamer = element;
            const preview = createKeyframePreview();
            const img = preview.querySelector("img");

            img.src = keyframeUrl;
            img.onload = () => {
                showPreviewAtPosition(event.clientX, event.clientY);
            };

            if (img.complete) {
                showPreviewAtPosition(event.clientX, event.clientY);
            }
        }
    }

    function handleStreamerHoverMove(event) {
        if (keyframePreview && keyframePreview.classList.contains("show")) {
            showPreviewAtPosition(event.clientX, event.clientY);
        }
    }

    function handleStreamerHoverOut(element) {
        if (keyframePreview && currentPreviewStreamer === element) {
            keyframePreview.classList.remove("show");
            currentPreviewStreamer = null;
        }
    }

    function showPreviewAtPosition(x, y) {
        if (!keyframePreview) return;

        const preview = keyframePreview;
        const img = preview.querySelector("img");

        if (!img.complete || img.naturalWidth === 0) return;

        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const previewWidth = Math.min(320, img.naturalWidth);
        const previewHeight = Math.min(180, img.naturalHeight);

        let left = x + 15;
        let top = y + 15;

        if (left + previewWidth > viewportWidth - 10) {
            left = x - previewWidth - 15;
        }

        if (top + previewHeight > viewportHeight - 10) {
            top = y - previewHeight - 15;
        }

        preview.style.width = previewWidth + "px";
        preview.style.height = previewHeight + "px";
        preview.style.left = Math.max(10, left) + "px";
        preview.style.top = Math.max(10, top) + "px";

        preview.classList.add("show");
    }

    // 初始化数据获取
    function initDataFetch() {
        try {
            console.log("开始初始化数据获取...");
            updateConnectionStatus(0);
            
            // 首次加载，尝试使用缓存
            fetchData(false);

            // 设置定时器，每5分钟刷新（但会先检查缓存）
            setInterval(() => fetchData(false), 5 * 60 * 1000);
        } catch (err) {
            console.error("初始化数据获取时出错:", err);
            Notify.error(`初始化失败: ${err.message}`, "初始化错误");
            setTimeout(initDataFetch, 5000);
        }
    }

    // 事件监听
    $search.addEventListener('input', filterStreamers);
    $statusFilter.addEventListener('change', filterStreamers);
    $sortOrder.addEventListener('change', function () {
        currentSort = this.value;
        filterStreamers();
    });
    
    // 刷新按钮 - 强制刷新（跳过缓存）
    document.getElementById('refresh-btn').addEventListener('click', () => fetchData(true));

    // 初始化
    try {
        initDataFetch();
    } catch (err) {
        console.error("程序初始化失败:", err);
        Notify.error(`程序初始化失败: ${err.message}`, "启动错误");
    }
});