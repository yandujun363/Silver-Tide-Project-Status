// ============================================================================
// AuraNotify - 轻量级通知系统
// 功能：支持多种通知类型、动画效果、自动关闭、回调函数等
// ============================================================================

class AuraNotify {
    constructor(containerSelector = '#aura-notice') {
        this.containerSelector = containerSelector;
        this.currentIndex = 0;
        this.notifications = new Map();
        this.isInitialized = false;

        this.init();
    }

    /**
     * 初始化通知系统
     */
    init() {
        if (this.isInitialized) return;

        // 创建通知容器（如果不存在）
        this.createContainer();

        // 绑定事件监听器
        this.bindEvents();

        this.isInitialized = true;
    }

    /**
     * 创建通知容器
     */
    createContainer() {
        if (document.querySelector(this.containerSelector)) return;

        const container = document.createElement('div');
        container.id = this.containerSelector.substring(1);
        container.className = 'aura-notice-container';
        document.body.appendChild(container);
    }

    /**
     * 绑定事件监听器
     */
    bindEvents() {
        const container = document.querySelector(this.containerSelector);

        // 关闭按钮点击事件
        container.addEventListener('click', (e) => {
            const closeBtn = e.target.closest('.aura-notice-close');
            if (!closeBtn) return;

            const notification = closeBtn.closest('.aura-notice');
            const index = parseInt(notification.dataset.index);

            if (e.shiftKey) {
                this.closeAll();
                return;
            }

            this.close(index);
        });

        // 通知点击事件（排除关闭按钮）
        container.addEventListener('click', (e) => {
            if (e.target.closest('.aura-notice-close')) return;

            const notification = e.target.closest('.aura-notice');
            if (!notification) return;

            const index = parseInt(notification.dataset.index);
            this.triggerCallback(index, 'click');
        });

        // 动画结束事件
        container.addEventListener('animationend', (e) => {
            const notification = e.target.closest('.aura-notice');
            if (!notification) return;

            // 移除入场动画类
            if (notification.classList.contains('aura-notice-enter')) {
                notification.classList.remove('aura-notice-enter');
            }

            // 处理退场动画
            if (notification.classList.contains('aura-notice-exit')) {
                notification.remove();
                const index = parseInt(notification.dataset.index);
                this.cleanupNotification(index);
            }
        });
    }

    /**
     * 显示通知
     * @param {Object} options 通知配置
     * @returns {number} 通知索引
     */
    show(options = {}) {
        const config = this.normalizeConfig(options);
        const index = this.currentIndex++;

        // 如果指定了ID，检查是否已存在
        if (config.id) {
            const existing = this.findByID(config.id);
            if (existing) this.close(existing.index, true);
        }

        // 创建通知元素
        const notification = this.createNotification(config, index);

        // 添加到容器
        const container = document.querySelector(this.containerSelector);
        container.prepend(notification);

        // 设置自动关闭
        let autoCloseTimer = null;
        if (config.duration > 0) {
            autoCloseTimer = setTimeout(() => {
                this.close(index);
            }, config.duration);
        }

        // 存储通知数据
        this.notifications.set(index, {
            id: config.id,
            config: config,
            callback: config.callback,
            timer: autoCloseTimer,
            controller: new NotificationController(this, index)
        });

        return index;
    }

    /**
     * 简化调用方法 - 显示信息通知
     * @param {string} message 消息内容
     * @param {string} title 标题
     * @param {Object} options 额外选项
     */
    info(message, title = '', options = {}) {
        return this.show({
            message,
            title,
            type: 'info',
            ...options
        });
    }

    /**
     * 简化调用方法 - 显示成功通知
     */
    success(message, title = '', options = {}) {
        return this.show({
            message,
            title,
            type: 'success',
            ...options
        });
    }

    /**
     * 简化调用方法 - 显示警告通知
     */
    warning(message, title = '', options = {}) {
        return this.show({
            message,
            title,
            type: 'warn',
            ...options
        });
    }

    /**
     * 简化调用方法 - 显示错误通知
     */
    error(message, title = '', options = {}) {
        return this.show({
            message,
            title,
            type: 'error',
            ...options
        });
    }

    /**
     * 标准化配置
     */
    normalizeConfig(options) {
        const defaults = {
            message: '',
            title: '',
            type: 'info',
            id: null,
            duration: 5000, // 0表示不自动关闭
            width: null,
            animation: true,
            callback: null,
            icon: null,
            customClass: ''
        };

        return { ...defaults, ...options };
    }

    /**
     * 创建通知元素
     */
    createNotification(config, index) {
        const notification = document.createElement('div');
        notification.className = `aura-notice aura-notice-${config.type} ${config.customClass}`;

        if (config.animation) {
            notification.classList.add('aura-notice-enter');
        }

        notification.dataset.index = index;
        if (config.id) notification.dataset.id = config.id;
        if (config.width) notification.style.width = config.width;

        // 构建通知内容
        const icon = config.icon ? this.createIcon(config.icon) : this.getDefaultIcon(config.type);
        const title = config.title ? `<div class="aura-notice-title">${config.title}</div>` : '';

        notification.innerHTML = `
            <div class="aura-notice-content">
                <div class="aura-notice-icon">${icon}</div>
                <div class="aura-notice-body">
                    ${title}
                    <div class="aura-notice-message">${config.message}</div>
                </div>
            </div>
            <button class="aura-notice-close" aria-label="关闭通知">×</button>
        `;

        return notification;
    }

    /**
     * 创建图标元素
     */
    createIcon(icon) {
        if (icon.startsWith('<')) return icon;
        return `<span class="aura-notice-icon-text">${icon}</span>`;
    }

    /**
     * 获取默认图标
     */
    getDefaultIcon(type) {
        const icons = {
            info: 'ℹ️',
            success: '✅',
            warn: '⚠️',
            error: '❌',
            alert: '🚨',
            trophy: '🏆',
            tips: '💡'
        };

        return `<span class="aura-notice-icon-text">${icons[type] || icons.info}</span>`;
    }

    /**
     * 通过ID查找通知
     */
    findByID(id) {
        for (const [index, data] of this.notifications.entries()) {
            if (data.id === id) return { index, data };
        }
        return null;
    }

    /**
     * 关闭通知
     * @param {number} index 通知索引
     * @param {boolean} immediate 是否立即移除（无动画）
     */
    close(index, immediate = false) {
        const notification = document.querySelector(
            `${this.containerSelector} .aura-notice[data-index="${index}"]`
        );

        if (!notification) {
            this.cleanupNotification(index);
            return;
        }

        if (immediate) {
            notification.remove();
            this.cleanupNotification(index);
        } else {
            notification.classList.add('aura-notice-exit');
        }

        this.triggerCallback(index, 'close');
    }

    /**
     * 通过ID关闭通知
     */
    closeByID(id, immediate = false) {
        const found = this.findByID(id);
        if (found) this.close(found.index, immediate);
    }

    /**
     * 关闭所有通知
     */
    closeAll() {
        const notifications = document.querySelectorAll(`${this.containerSelector} .aura-notice`);
        notifications.forEach(notification => {
            notification.classList.add('aura-notice-exit');
        });

        // 清理所有存储的数据
        this.notifications.forEach((data, index) => {
            this.cleanupNotification(index);
        });
    }

    /**
     * 清理通知数据
     */
    cleanupNotification(index) {
        const data = this.notifications.get(index);
        if (data) {
            if (data.timer) clearTimeout(data.timer);
            this.notifications.delete(index);
        }
    }

    /**
     * 触发回调函数
     */
    triggerCallback(index, action) {
        const data = this.notifications.get(index);
        if (data && typeof data.callback === 'function') {
            data.callback(action, data.controller);
        }
    }

    /**
     * 更新通知标题
     */
    updateTitle(index, title) {
        const notification = document.querySelector(
            `${this.containerSelector} .aura-notice[data-index="${index}"] .aura-notice-title`
        );
        if (notification) notification.textContent = title;
    }

    /**
     * 更新通知内容
     */
    updateMessage(index, message) {
        const notification = document.querySelector(
            `${this.containerSelector} .aura-notice[data-index="${index}"] .aura-notice-message`
        );
        if (notification) notification.textContent = message;
    }

    /**
     * 获取通知数量
     */
    getCount() {
        return document.querySelectorAll(`${this.containerSelector} .aura-notice`).length;
    }
}

/**
 * 通知控制器类
 * 用于在回调函数中操作通知
 */
class NotificationController {
    constructor(notifier, index) {
        this.notifier = notifier;
        this.index = index;
    }

    /**
     * 立即关闭通知（无动画）
     */
    remove() {
        this.notifier.close(this.index, true);
    }

    /**
     * 关闭通知（带动画）
     */
    close() {
        this.notifier.close(this.index, false);
    }

    /**
     * 更新标题
     */
    setTitle(title) {
        this.notifier.updateTitle(this.index, title);
    }

    /**
     * 更新内容
     */
    setMessage(message) {
        this.notifier.updateMessage(this.index, message);
    }

    /**
     * 获取通知索引
     */
    getIndex() {
        return this.index;
    }
}

// 浏览器全局变量
if (typeof window !== 'undefined') {
    window.AuraNotify = AuraNotify;
    window.NotificationController = NotificationController;
}

// ES Module 导出
export { AuraNotify, NotificationController };
export default AuraNotify;