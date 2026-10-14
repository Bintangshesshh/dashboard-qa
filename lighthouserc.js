// url eksplisit: autodiscover cuma ambil 5 URL (maxAutodiscoverUrls default 5, depth 2)
// additive:true - LHCI nggak ngehapus lhr-*.html lama tiap run. Tanpa ini, run gagal
// EPERM unlink kalau file lama nggak bisa dihapus (mis. punya Administrators).
module.exports={ci:{collect:{staticDistDir:'./docusaurus/build',numberOfRuns:1,additive:true,url:['/','/dashboard/','/blog/','/404.html']},assert:{assertions:{'categories:performance':['warn',{minScore:0.9}],'categories:accessibility':['error',{minScore:0.9}]}},upload:{target:'filesystem',outputDir:'./lhci-results'}}};
