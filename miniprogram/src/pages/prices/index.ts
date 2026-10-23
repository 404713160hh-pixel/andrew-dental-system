import type { TreatmentReference } from '../../types';
import { api, errorMessage, query } from '../../utils/api';
import { referenceView } from '../../utils/catalog';

Page({
  requestSequence: 0,
  data: {
    loading: false, error: '', items: [] as ReturnType<typeof referenceView>[], filteredItems: [] as ReturnType<typeof referenceView>[],
    categories: ['全部'], selectedCategory: '全部', keyword: '', expandedId: '', referenceYearLabel: '',
  },
  onLoad() { void this.load(); },
  onUnload() { this.requestSequence++; },
  async onPullDownRefresh() { await this.load(); wx.stopPullDownRefresh(); },
  async load() {
    const request = ++this.requestSequence;
    this.setData({ loading: true, error: '' });
    try {
      const items = await api<TreatmentReference[]>('/treatment-references');
      if (request !== this.requestSequence) return;
      const categories = ['全部', ...new Set(items.map(item => item.category))];
      this.setData({ items: items.map(referenceView), categories, selectedCategory: categories.includes(this.data.selectedCategory) ? this.data.selectedCategory : '全部', referenceYearLabel: [...new Set(items.map(item => item.referenceYear))].join(' / ') });
      this.filterItems();
    } catch (error) { if (request === this.requestSequence) this.setData({ error: errorMessage(error) }); }
    finally { if (request === this.requestSequence) this.setData({ loading: false }); }
  },
  filterItems() {
    const keyword = this.data.keyword.trim().toLowerCase();
    this.setData({ filteredItems: this.data.items.filter(item => (this.data.selectedCategory === '全部' || item.category === this.data.selectedCategory) && (!keyword || [item.name, item.category, item.description].join(' ').toLowerCase().includes(keyword))) });
  },
  searchInput(event: WechatMiniprogram.CustomEvent<{ value: string }>) { this.setData({ keyword: event.detail.value }); this.filterItems(); },
  categoryTap(event: WechatMiniprogram.BaseEvent) { this.setData({ selectedCategory: String(event.currentTarget.dataset.category), expandedId: '' }); this.filterItems(); },
  toggle(event: WechatMiniprogram.BaseEvent) { const id = String(event.currentTarget.dataset.id); this.setData({ expandedId: this.data.expandedId === id ? '' : id }); },
  consult(event: WechatMiniprogram.BaseEvent) {
    const item = this.data.items.find(candidate => candidate.id === String(event.currentTarget.dataset.id));
    if (!item?.bookingServiceId) { wx.showToast({ title: '请联系门诊了解咨询安排', icon: 'none' }); return; }
    // A treatment-course estimate is never sent as a booking fee or hold price.
    wx.navigateTo({ url: '/pages/booking/index' + query({ serviceId: item.bookingServiceId }) });
  },
});
