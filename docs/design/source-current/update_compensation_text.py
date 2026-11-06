"""Shared TeX formatting helpers used by the schema synchronizer.

The edited business text is maintained in main.tex.
"""
def t(s):
    escaped={'\\':r'\textbackslash{}','&':r'\&','%':r'\%','#':r'\#','$':r'\$','_':r'\_\allowbreak{}','{':r'\{','}':r'\}','\n':r'\\','/':r'/\allowbreak{}','→':r'→\allowbreak{}'}
    return ''.join(escaped.get(c,c) for c in str(s))

def table(caption,heads,rows,label,widths=None):
    widths=widths or ([2.4,12.7] if len(heads)==2 else [3.5,5.0,6.4])
    spec='@{}'+('@{\\hspace{0.16cm}}'.join('p{'+str(w)+'cm}' for w in widths))+'@{}'
    row=lambda a:' & '.join(r'\Cell{'+t(x)+'}' for x in a)+r'\\[2pt]'
    head=' & '.join(r'\bfseries \Cell{'+t(x)+'}' for x in heads)+r'\\\midrule'
    return '\n'.join([r'{\fontsize{10.5pt}{13.2pt}\selectfont\setlength{\tabcolsep}{0pt}\renewcommand{\arraystretch}{1.08}',r'\begin{longtable}{'+spec+'}',r'\caption{'+t(caption)+r'}\label{'+label+r'}\\',r'\toprule',head,r'\endfirsthead',r'\toprule',head,r'\endhead',r'\bottomrule\endlastfoot',*[row(r) for r in rows],r'\end{longtable}','}'])+'\n'

def fig(file,caption):
    return r'\begin{figure}[H]\centering\includegraphics[width=\textwidth,height=.83\textheight,keepaspectratio]{figures/'+file+r'.pdf}'+'\n'+r'\caption{'+t(caption)+r'}\label{'+file+r'}\end{figure}'+'\n'
