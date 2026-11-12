import { educationArticles } from '../../utils/education';

Page({
  data: { articles: educationArticles, article: null as (typeof educationArticles)[number] | null },
  onLoad(query: Record<string, string | undefined>) {
    if (query.id) this.setData({ article: educationArticles.find(article => article.id === query.id) ?? null });
  },
  copySource() {
    const source = this.data.article?.source;
    if (source) wx.setClipboardData({ data: source.url });
  },
});
