import type { PatientInput } from '../../types';
import { dateToday, emptyProfile } from '../../utils/format';
Component({
  properties: { value: { type: Object, value: emptyProfile() }, disabled: { type: Boolean, value: false } },
  data: { maxDate: dateToday(), allergyNames: ['待核实', '声明无已知过敏', '有已知过敏'], allergyIndex: 0, allergyText: '' },
  observers: { value(value: PatientInput) {
    const currentNormalized = [...new Set(this.data.allergyText.split(/\n/).map(item => item.trim()).filter(Boolean))].join('\n');
    const incoming = value.allergies.join('\n');
    this.setData({ allergyIndex: ['unknown', 'none_reported', 'known'].indexOf(value.allergyStatus), ...(currentNormalized !== incoming ? { allergyText: incoming } : {}) });
  } },
  methods: {
    input(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
      const name = event.currentTarget.dataset.field as keyof PatientInput;
      const profile = { ...(this.properties.value as PatientInput), [name]: event.detail.value };
      this.triggerEvent('change', profile);
    },
    allergy(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
      const states = ['unknown', 'none_reported', 'known'] as const;
      const status = states[Number(event.detail.value)] ?? 'unknown';
      const profile = this.properties.value as PatientInput;
      this.triggerEvent('change', { ...profile, allergyStatus: status, allergies: status === 'known' ? profile.allergies : [] });
    },
    allergies(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
      this.setData({ allergyText: event.detail.value });
      const allergies = [...new Set(event.detail.value.split(/\n/).map(value => value.trim()).filter(Boolean))];
      this.triggerEvent('change', { ...(this.properties.value as PatientInput), allergies });
    }
  }
});
