// Independent, non-real-time CW oracle: FFT channel selection, inverse FFT,
// heterodyne and interpolation. Does not reuse the production IIR or AGC code.
function fft(re,im,inverse=false){
  const n=re.length;
  for(let i=1,j=0;i<n;i++){
    let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;
    if(i<j){[re[i],re[j]]=[re[j],re[i]];[im[i],im[j]]=[im[j],im[i]];}
  }
  for(let size=2;size<=n;size*=2){
    const angle=(inverse?2:-2)*Math.PI/size,wr=Math.cos(angle),wi=Math.sin(angle);
    for(let base=0;base<n;base+=size){
      let ar=1,ai=0;
      for(let j=0;j<size/2;j++){
        const a=base+j,b=a+size/2,br=re[b]*ar-im[b]*ai,bi=re[b]*ai+im[b]*ar;
        re[b]=re[a]-br;im[b]=im[a]-bi;re[a]+=br;im[a]+=bi;
        const next=ar*wr-ai*wi;ai=ar*wi+ai*wr;ar=next;
      }
    }
  }
  if(inverse)for(let i=0;i<n;i++){re[i]/=n;im[i]/=n;}
}
function referenceCw(iq,rate,offset,halfWidth=900){
  let n=1;while(n<iq.length/2)n*=2;
  const re=new Float64Array(n),im=new Float64Array(n);
  for(let i=0;i<iq.length/2;i++){re[i]=(iq[i*2]-127.5)/127.5;im[i]=(iq[i*2+1]-127.5)/127.5;}
  fft(re,im);
  for(let k=0;k<n;k++){
    const hz=(k<=n/2?k:k-n)*rate/n;
    if(Math.abs(hz-offset)>halfWidth)re[k]=im[k]=0;
  }
  fft(re,im,true);
  const pcm=new Float64Array(Math.floor(iq.length/2*48000/rate));
  for(let i=0;i<pcm.length;i++){
    const x=i*rate/48000,a=Math.floor(x),f=x-a,b=Math.min(a+1,n-1),phase=2*Math.PI*(700-offset)*i/48000;
    pcm[i]=((re[a]*(1-f)+re[b]*f)*Math.cos(phase)-(im[a]*(1-f)+im[b]*f)*Math.sin(phase))*24000;
  }
  return pcm;
}
module.exports={referenceCw};
