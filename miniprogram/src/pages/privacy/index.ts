import { api, errorMessage } from '../../utils/api';

interface PrivacyNotice {
  policyVersion: string;
  purpose: string;
  controller: string;
  contact: string;
  retention: string;
}

Page({
  requestSequence: 0,
  data: { notice: null as PrivacyNotice | null, loading: false, error: '' },
  onLoad() { void this.load(); },
  onUnload() { this.requestSequence++; },
  async load() {
    const sequence = ++this.requestSequence;
    this.setData({ loading: true, error: '' });
    try {
      const notice = await api<PrivacyNotice>('/privacy/notice');
      if (sequence === this.requestSequence) this.setData({ notice });
    } catch (error) {
      if (sequence === this.requestSequence) this.setData({ error: errorMessage(error) });
    } finally {
      if (sequence === this.requestSequence) this.setData({ loading: false });
    }
  },
  back() { wx.navigateBack(); },
});
