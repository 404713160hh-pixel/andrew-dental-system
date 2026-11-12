interface Article {
  id: string;
  topic: string;
  title: string;
  cause: string;
  prevention: string;
  aftercare: string;
  source: { label: string; url: string };
}

export const educationArticles: Article[] = [
  {
    id: 'checkup', topic: '初诊检查', title: '牙齿不痛，也需要检查吗？',
    cause: '龋齿早期可能没有疼痛。牙医会检查牙齿和牙龈，结合你说的症状判断是否需要进一步检查。',
    prevention: '每天用含氟牙膏刷牙两次，清洁牙缝，减少频繁吃甜食和喝含糖饮料。和牙医约定适合自己的复查间隔。',
    aftercare: '单纯检查一般不需要恢复。如果当天还做了治疗，请按牙医交代的护理和复查安排执行。',
    source: { label: 'NHS · 龋齿', url: 'https://www.nhs.uk/conditions/tooth-decay/' },
  },
  {
    id: 'gums', topic: '普通咨询', title: '刷牙出血，可能是什么原因？',
    cause: '牙菌斑长期积聚会刺激牙龈。牙龈出血也可能有其他原因，需要结合牙医检查判断。',
    prevention: '每天清洁牙面和牙缝，尤其留意牙龈边缘。经常出血、红肿或牙齿松动时，尽早预约检查。',
    aftercare: '洁牙或牙周治疗后，按牙医示范的方式清洁和复查。如果出血持续或不适加重，请联系门诊。',
    source: { label: 'NIDCR · 牙周疾病', url: 'https://www.nidcr.nih.gov/health-info/gum-disease' },
  },
  {
    id: 'children', topic: '儿童口腔咨询', title: '怎样降低孩子蛀牙的风险？',
    cause: '口腔细菌会利用食物和饮料中的糖产生酸。反复接触糖分会增加牙齿脱矿的机会。',
    prevention: '家长协助刷牙，选用牙医建议的含氟牙膏用量，减少两餐之间的甜食和甜饮。可在面诊时询问涂氟和窝沟封闭是否适合孩子。',
    aftercare: '涂氟、封闭和补牙后的要求各有不同，按接诊牙医给出的饮食、清洁和复查安排执行。',
    source: { label: 'NIDCR · 儿童龋齿预防', url: 'https://www.nidcr.nih.gov/health-info/tooth-decay/more-info/tooth-decay-process' },
  },
  {
    id: 'restoration', topic: '修复治疗评估', title: '补牙、根管和牙冠有什么区别？',
    cause: '龋坏、磨耗或外伤可能造成牙体缺损。补牙修复缺损，根管治疗处理感染的牙髓，牙冠可在合适的情况下保护和修复牙体。',
    prevention: '用含氟牙膏刷牙、清洁牙缝，发现牙齿裂损、敏感或疼痛时请牙医评估。',
    aftercare: '局部麻醉尚未消退时，注意避免咬伤嘴唇和脸颊。按约复诊并完成后续修复，疼痛或肿胀明显加重时联系门诊。',
    source: { label: 'NHS · 根管治疗与恢复', url: 'https://www.nhs.uk/tests-and-treatments/root-canal-treatment/' },
  },
  {
    id: 'implant', topic: '种植方案咨询', title: '缺牙想做种植，先了解什么？',
    cause: '龋坏、牙周病和外伤都可能导致缺牙。种植是修复选项之一，牙医会评估牙周、骨量和全身健康状况。',
    prevention: '日常清洁牙面和牙缝，定期检查牙周状况，避免吸烟。出现牙齿松动时尽早检查。',
    aftercare: '种植术后可能出现肿胀或不适。饮食、清洁手术区和复查时间按手术医生的安排执行。持续出血或肿痛加重时及时联系门诊。',
    source: { label: 'Guy’s and St Thomas’ NHS · 种植术后护理', url: 'https://www.guysandstthomas.nhs.uk/health-information/dental-implants/after-having-dental-implant' },
  },
  {
    id: 'orthodontics', topic: '正畸方案咨询', title: '戴牙套后，哪些地方容易漏刷？',
    cause: '牙列拥挤或咬合问题可通过面诊评估。固定矫治器容易滞留食物，托槽周围和牙龈边缘尤其需要清洁。',
    prevention: '用含氟牙膏刷牙，按牙医指导用牙间刷清洁托槽和牙缝，减少频繁吃甜食和喝含糖饮料。',
    aftercare: '按时复诊，托槽松脱、钢丝扎嘴或疼痛持续时联系正畸门诊。拆除矫治器后，按医生安排佩戴保持器。',
    source: { label: 'NHS · 牙套清洁与护理', url: 'https://www.nhs.uk/tests-and-treatments/braces/' },
  },
];
