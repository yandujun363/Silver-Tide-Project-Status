import AuraNotify from "/js/AuraNotify.js";

let keyframePreview = null;
let currentPreviewStreamer = null;

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

    let streamers = [];
    let isRefreshing = false;
    const Notify = new AuraNotify();

    // 排序配置
    const sortOptions = {
        name_asc: { key: "name", order: "asc", text: "名称A-Z" },
        name_desc: { key: "name", order: "desc", text: "名称Z-A" },
        live_desc: { key: "living", order: "desc", text: "直播优先" },
        live_asc: { key: "living", order: "asc", text: "未直播优先" },
    };

    let currentSort = "live_desc";

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

    // 获取主播UID列表
    async function loadStreamersData() {
        try {
            const response = await fetch(`/data.json?_t=${Date.now()}`);
            if (!response.ok) {
                throw new Error(`加载数据失败: ${response.status}`);
            }
            const data = await response.json();

            if (!Array.isArray(data)) {
                throw new Error('数据格式错误，应为数组');
            }

            const validUids = data.filter(uid => {
                return typeof uid === 'string' && /^\d+$/.test(uid);
            });

            if (validUids.length === 0) {
                throw new Error('未找到有效的UID数据');
            }

            console.log(`加载了 ${validUids.length} 个有效UID`);
            return validUids;
        } catch (err) {
            console.error('加载UID数据失败:', err);
            Notify.error(`加载UID数据失败: ${err.message}`, "数据加载");
            return [];
        }
    }

    // 获取直播状态 - 修改API地址
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

    // 合并主播数据和直播状态
    async function fetchData() {
        if (isRefreshing) return;

        isRefreshing = true;
        const $refreshBtn = document.getElementById('refresh-btn');
        $refreshBtn.querySelector("svg").classList.add("refreshing");
        updateConnectionStatus(0);

        try {
            const uids = await loadStreamersData();

            if (uids.length === 0) {
                throw new Error('未找到主播UID数据');
            }

            console.log(`获取到 ${uids.length} 个主播UID:`, uids);

            const liveStatus = await fetchLiveStatus(uids);

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

            console.log(`成功获取 ${streamers.length} 个主播的直播状态`);

            filterStreamers();
            updateStats();
            updateConnectionStatus(1);

            $lastUpdate.textContent = new Date().toLocaleString('zh-CN');

            Notify.success(`数据更新成功 (${streamers.length}位主播)`, "数据更新", {
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
                $container.innerHTML = '<p class="no-results">没有找到匹配的主主播</p>';
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
            fetchData();

            setInterval(fetchData, 5 * 60 * 1000);
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
    document.getElementById('refresh-btn').addEventListener('click', fetchData);

    // 初始化
    try {
        initDataFetch();
    } catch (err) {
        console.error("程序初始化失败:", err);
        Notify.error(`程序初始化失败: ${err.message}`, "启动错误");
    }
});