import type { Appointment, Page as ResultPage } from '../../types';
import { api, errorMessage, query } from '../../utils/api';
import { inspectCommand, pendingCommand, sendCommand } from '../../utils/booking';
import { appointmentView } from '../../utils/format';
import { session } from '../../utils/session';
Page({
  data: { ownerId: '', signedIn: false, loading: false, busy: false, error: '', items: [] as ReturnType<typeof appointmentView>[], total: 0, page: 1, pageSize: 10, status: '', pending: false, hasMore: false, filterNames: ['全部预约', '预约已确认', '已取消', '已改期'], filterIndex: 0 },
  onShow() {
    const ownerId = session()?.user.id ?? '';
    if (this.data.ownerId !== ownerId) this.setData({ ownerId, items: [], total: 0, page: 1, hasMore: false, error: '', loading: false, busy: false });
    this.setData({ signedIn: Boolean(ownerId), pending: Boolean(pendingCommand()) }); if (ownerId) void this.load(true);
  },
  async onPullDownRefresh() { if (session()) await this.load(true); wx.stopPullDownRefresh(); },
  onReachBottom() { if (this.data.hasMore && !this.data.loading) void this.load(false); },
  async load(reset = true) {
    if (this.data.loading) return;
    const ownerId = session()?.user.id; if (!ownerId) return;
    this.setData({ loading: true, error: '' });
    try {
      const page = reset ? 1 : this.data.page + 1;
      const result = await api<ResultPage<Appointment>>('/appointments' + query({ status: this.data.status, page, pageSize: this.data.pageSize }));
      if (session()?.user.id !== ownerId || this.data.ownerId !== ownerId) return;
      const items = reset ? result.items.map(appointmentView) : [...this.data.items, ...result.items.map(appointmentView)];
      this.setData({ items, total: result.total, page: result.page, hasMore: result.page * result.pageSize < result.total });
    } catch (error) { if (this.data.ownerId === ownerId && (!session() || session()?.user.id === ownerId)) this.setData({ error: errorMessage(error), signedIn: Boolean(session()), ...(!session() ? { items: [], total: 0, hasMore: false } : {}) }); }
    finally { if (this.data.ownerId === ownerId) this.setData({ loading: false }); }
  },
  filter(event: WechatMiniprogram.CustomEvent<{ value: string }>) { const index = Number(event.detail.value); this.setData({ filterIndex: index, status: ['', 'confirmed', 'cancelled', 'rescheduled'][index] ?? '' }); void this.load(true); },
  refresh() { void this.load(true); },
  more() { void this.load(false); },
  detail(event: WechatMiniprogram.BaseEvent) { wx.navigateTo({ url: '/pages/detail/index?id=' + encodeURIComponent(String(event.currentTarget.dataset.id)) }); },
  login() { wx.navigateTo({ url: '/pages/login/index' }); },
  book() { wx.navigateTo({ url: '/pages/booking/index' }); },
  async inspect() {
    if (this.data.busy) return; this.setData({ busy: true, error: '' });
    try { const result = await inspectCommand(); if (result) { wx.navigateTo({ url: '/pages/detail/index?id=' + encodeURIComponent(result.id) }); await this.load(true); } else this.setData({ error: '暂未查到已完成结果。原请求已保留，请稍后核对或重试原操作。' }); }
    catch (error) { this.setData({ error: errorMessage(error) }); } finally { this.setData({ busy: false, pending: Boolean(pendingCommand()) }); }
  },
  async retry() {
    const command = pendingCommand(); if (!command || this.data.busy) return;
    this.setData({ busy: true, error: '' });
    try { const result = await sendCommand(command); wx.navigateTo({ url: '/pages/detail/index?id=' + encodeURIComponent(result.id) }); await this.load(true); }
    catch (error) { this.setData({ error: errorMessage(error) }); } finally { this.setData({ busy: false, pending: Boolean(pendingCommand()) }); }
  }
});
