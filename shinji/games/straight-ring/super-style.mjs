export const SUPER_STYLES=Object.freeze(['bolt','ink','prism','impact','wave']);
export const SUPER_ACCENTS=Object.freeze({
  bolt:'#72e9ff',ink:'#ff6b75',prism:'#e0a5ff',impact:'#ffd779',wave:'#79ffd6',
});
// Draw without replacement. Also avoid a repeat when refilling the deck.
export function createSuperStyleDeck(random=Math.random){
  let deck=[],previous,alternate=false;
  return ()=>{
    if(!deck.length){
      deck=[...SUPER_STYLES];
      for(let i=deck.length-1;i>0;i--){
        const j=Math.floor(random()*(i+1));
        [deck[i],deck[j]]=[deck[j],deck[i]];
      }
      if(deck[0]===previous)[deck[0],deck[1]]=[deck[1],deck[0]];
    }
    const style=deck.shift();previous=style;alternate=!alternate;
    return {style,alternate};
  };
}
