import { useMemo, useState } from 'react';
import { BarChart3, Check, CircleHelp, Copy, ExternalLink, Gauge, Github, LockKeyhole, RefreshCw, Rocket, ShieldCheck, Sparkles, Wallet, Zap } from 'lucide-react';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, createAssociatedTokenAccountInstruction, createInitializeMintInstruction, createMintToInstruction, getAssociatedTokenAddressSync, getMinimumBalanceForRentExemptMint, getMintLen } from '@solana/spl-token';

declare global {
  interface Window {
    solana?: SolanaProvider;
    phantom?: { solana?: SolanaProvider };
  }
}
interface SolanaProvider {
  isPhantom?: boolean;
  publicKey?: PublicKey;
  connect: () => Promise<{ publicKey: PublicKey }>;
  signTransaction: (tx: Transaction) => Promise<Transaction>;
}

const RPC = 'https://api.devnet.solana.com';
const EXPLORER = 'https://explorer.solana.com';
const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const fmt = (n:number) => new Intl.NumberFormat('en-US',{maximumFractionDigits:0}).format(n);

async function hashText(input:string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
function memoInstruction(text:string, signer:PublicKey) {
  return new TransactionInstruction({
    keys:[{pubkey:signer,isSigner:true,isWritable:false}],
    programId:MEMO_PROGRAM_ID,
    data:new TextEncoder().encode(text)
  });
}

export default function App() {
  const [tab,setTab]=useState<'launch'|'proof'|'protocol'|'network'>('launch');
  const [name,setName]=useState('Nuvex Community');
  const [symbol,setSymbol]=useState('NUVX');
  const [supply,setSupply]=useState('1000000');
  const [decimals,setDecimals]=useState('6');
  const [publicPct,setPublicPct]=useState(70);
  const [liquidityPct,setLiquidityPct]=useState(15);
  const [treasuryPct,setTreasuryPct]=useState(10);
  const [teamPct,setTeamPct]=useState(5);
  const [walletCap,setWalletCap]=useState(2);
  const [participants,setParticipants]=useState(180);
  const [connected,setConnected]=useState(false);
  const [wallet,setWallet]=useState('');
  const [status,setStatus]=useState<'idle'|'connecting'|'launching'|'success'|'error'>('idle');
  const [error,setError]=useState('');
  const [signature,setSignature]=useState('');
  const [mintAddress,setMintAddress]=useState('');
  const [proofHash,setProofHash]=useState('');
  const [copied,setCopied]=useState(false);
  const [verification,setVerification]=useState<'idle'|'checking'|'verified'|'failed'>('idle');
  const [verificationMessage,setVerificationMessage]=useState('');

  const totalSupply=Number(supply)||0;
  const totalPct=publicPct+liquidityPct+treasuryPct+teamPct;
  const publicPool=totalSupply*publicPct/100;
  const capAmount=publicPool*walletCap/100;

  const sampleClaims=useMemo(()=>{
    const requests=[capAmount*1.6,capAmount*1.15,capAmount*.7,capAmount*.4,capAmount*2.1,capAmount*.9];
    const capped=requests.map(x=>Math.min(x,capAmount));
    const demand=capped.reduce((a,b)=>a+b,0);
    const factor=demand>publicPool?publicPool/demand:1;
    return capped.map((x,i)=>({wallet:'7hQ...'+String(i+2).padStart(2,'0'),requested:requests[i],allocation:x*factor}));
  },[capAmount,publicPool]);

  function provider(){ return window.phantom?.solana || window.solana; }

  async function connectWallet(){
    setError(''); setStatus('connecting');
    try {
      const p=provider();
      if(!p) throw new Error('No Solana wallet detected. Install Phantom, unlock it, then reload this page.');
      const r=await p.connect();
      const key=r?.publicKey||p.publicKey;
      if(!key) throw new Error('Wallet connected but did not return a public key.');
      setWallet(key.toBase58()); setConnected(true); setStatus('idle');
    } catch(e) {
      const m=e instanceof Error?e.message:'Wallet connection failed.';
      setError(m.toLowerCase().includes('user rejected')?'Connection was cancelled in your wallet. Click Connect wallet and approve the request.':m);
      setStatus('error');
    }
  }

  async function launchOnDevnet(){
    setError('');
    if(totalPct!==100){setError('Allocation must total exactly 100%.');return;}
    const p=provider();
    if(!connected || !p?.publicKey){await connectWallet();return;}
    setStatus('launching');
    try {
      const creator=p.publicKey;
      const connection=new Connection(RPC,'confirmed');
      const mint=Keypair.generate();
      const mintRent=await getMinimumBalanceForRentExemptMint(connection);
      const ata=getAssociatedTokenAddressSync(mint.publicKey,creator,false,TOKEN_PROGRAM_ID,ASSOCIATED_TOKEN_PROGRAM_ID);
      const config={version:1,name,symbol,supply:totalSupply,decimals:Number(decimals),allocation:{publicPct,liquidityPct,treasuryPct,teamPct},walletCap,participantCount:participants,algorithm:'capped-pro-rata-v1'};
      const proof=await hashText(JSON.stringify(config));
      setProofHash(proof);
      const memo='NUVEX_FAIR_LAUNCH:v1|'+symbol+'|public='+publicPct+'|cap='+walletCap+'|participants='+participants+'|algo=capped-pro-rata-v1|proof='+proof.slice(0,48);
      const latest=await connection.getLatestBlockhash('confirmed');
      const tx=new Transaction({feePayer:creator,recentBlockhash:latest.blockhash});
      const baseUnits=Math.floor(totalSupply*Math.pow(10,Number(decimals)));
      tx.add(
        SystemProgram.createAccount({fromPubkey:creator,newAccountPubkey:mint.publicKey,lamports:mintRent,space:getMintLen([]),programId:TOKEN_PROGRAM_ID}),
        createInitializeMintInstruction(mint.publicKey,Number(decimals),creator,creator,TOKEN_PROGRAM_ID),
        createAssociatedTokenAccountInstruction(creator,ata,creator,mint.publicKey,TOKEN_PROGRAM_ID,ASSOCIATED_TOKEN_PROGRAM_ID),
        createMintToInstruction(mint.publicKey,ata,creator,baseUnits),
        memoInstruction(memo,creator)
      );
      tx.partialSign(mint);
      const signed=await p.signTransaction(tx);
      const sig=await connection.sendRawTransaction(signed.serialize(),{skipPreflight:false});
      await connection.confirmTransaction({signature:sig,blockhash:latest.blockhash,lastValidBlockHeight:latest.lastValidBlockHeight},'confirmed');
      setSignature(sig); setMintAddress(mint.publicKey.toBase58()); setStatus('success'); setTab('proof');
    } catch(e) {
      setError(e instanceof Error?e.message:'Devnet launch failed.'); setStatus('error');
    }
  }

  async function verifyOnChainProof(){
    if(!signature||!proofHash)return;
    setVerification('checking'); setVerificationMessage('Reading the confirmed Devnet transaction...');
    try {
      const connection=new Connection(RPC,'confirmed');
      const tx=await connection.getParsedTransaction(signature,{commitment:'confirmed',maxSupportedTransactionVersion:0});
      if(!tx) throw new Error('Transaction is not available from Devnet yet.');
      const memo=tx.transaction.message.instructions.find(ix=>'programId' in ix && ix.programId.equals(MEMO_PROGRAM_ID) && typeof (ix as any).parsed==='string') as any;
      if(!memo||!memo.parsed.includes('proof='+proofHash.slice(0,48))) throw new Error('The on-chain memo does not match this launch proof.');
      setVerification('verified'); setVerificationMessage('Verified: the Devnet transaction contains the committed policy proof.');
    } catch(e){setVerification('failed');setVerificationMessage(e instanceof Error?e.message:'On-chain verification failed.');}
  }

  function copyProof(){navigator.clipboard?.writeText(proofHash);setCopied(true);setTimeout(()=>setCopied(false),1200);}

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="brand-mark">N</div><div><div className="brand-name">NUVEX</div><div className="brand-sub">FAIR LAUNCH</div></div></div>
      <div className="network-pill"><span className="live-dot"/> SOLANA DEVNET</div>
      <button className={'wallet-btn '+(connected?'connected':'')} onClick={connectWallet}><Wallet size={17}/>{connected?wallet.slice(0,4)+'...'+wallet.slice(-4):'Connect wallet'}</button>
    </header>
    <main className="page">
      <section className="hero">
        <div className="eyebrow"><Sparkles size={15}/> CREATE → TRADE → STAKE</div>
        <h1>Launch without<br/><span>insider advantage.</span></h1>
        <p>Nuvex turns token launches into transparent, auditable allocation events — with capped pro-rata distribution and a cryptographic proof committed on Solana.</p>
        <div className="hero-tags"><span><ShieldCheck size={14}/> Wallet cap</span><span><Gauge size={14}/> Pro-rata allocation</span><span><LockKeyhole size={14}/> On-chain proof</span></div>
      </section>
      <nav className="tabs">
        <button className={tab==='launch'?'active':''} onClick={()=>setTab('launch')}><Rocket size={16}/> Launch Studio</button>
        <button className={tab==='proof'?'active':''} onClick={()=>setTab('proof')}><ShieldCheck size={16}/> Allocation Proof</button>
        <button className={tab==='protocol'?'active':''} onClick={()=>setTab('protocol')}><LockKeyhole size={16}/> Protocol</button>
        <button className={tab==='network'?'active':''} onClick={()=>setTab('network')}><BarChart3 size={16}/> Network</button>
      </nav>

      {tab==='launch' && <section className="grid">
        <div className="panel">
          <div className="panel-head"><div><span className="kicker">01 / CONFIGURE</span><h2>Fair launch parameters</h2></div><span className="step">DEVNET</span></div>
          <div className="form-grid">
            <label>Token name<input value={name} onChange={e=>setName(e.target.value)}/></label>
            <label>Symbol<input value={symbol} maxLength={8} onChange={e=>setSymbol(e.target.value.toUpperCase())}/></label>
            <label>Initial supply<input value={supply} onChange={e=>setSupply(e.target.value.replace(/\D/g,''))}/></label>
            <label>Decimals<input value={decimals} onChange={e=>setDecimals(e.target.value.replace(/\D/g,'').slice(0,2))}/></label>
          </div>
          <div className="section-label">Allocation policy</div>
          <div className="allocation-fields">
            {([['Public fair-launch',publicPct,setPublicPct],['Liquidity',liquidityPct,setLiquidityPct],['Treasury',treasuryPct,setTreasuryPct],['Team / vesting',teamPct,setTeamPct]] as const).map(([label,val,setter])=><label key={label}>{label}<div className="percent-input"><input type="number" value={val} onChange={e=>setter(Number(e.target.value))}/><span>%</span></div></label>)}
          </div>
          <div className="controls">
            <label><span>Max per wallet (of public pool)</span><div className="range-row"><input type="range" min=".5" max="10" step=".5" value={walletCap} onChange={e=>setWalletCap(Number(e.target.value))}/><b>{walletCap}%</b></div></label>
            <label><span>Expected participants</span><div className="range-row"><input type="range" min="20" max="1000" step="10" value={participants} onChange={e=>setParticipants(Number(e.target.value))}/><b>{participants}</b></div></label>
          </div>
          <div className={'allocation-total '+(totalPct===100?'ok':'bad')}><span>Total allocation</span><strong>{totalPct}%</strong>{totalPct===100?<Check size={17}/>:<CircleHelp size={17}/>}</div>
          {error&&<div className="error">{error}</div>}
          <button className="primary-cta" onClick={launchOnDevnet} disabled={status==='launching'}>{status==='launching'?<><RefreshCw className="spin" size={18}/> Signing on Devnet...</>:<><Zap size={18}/>{connected?'Launch + commit proof':'Connect wallet to launch'}<ExternalLink size={16}/></>}</button>
          <div className="fineprint">Creates a real SPL mint on Solana Devnet and writes the launch policy proof to the Memo program. Devnet SOL has no real value.</div>
        </div>
        <aside className="panel">
          <div className="panel-head"><div><span className="kicker">02 / PREVIEW</span><h2>Allocation engine</h2></div></div>
          <div className="donut" style={{background:`conic-gradient(#8b5cf6 0 ${publicPct}%,#22d3ee ${publicPct}% ${publicPct+liquidityPct}%,#60a5fa ${publicPct+liquidityPct}% ${publicPct+liquidityPct+treasuryPct}%,#334155 ${publicPct+liquidityPct+treasuryPct}% 100%)`}}><div><strong>{fmt(publicPool)}</strong><span>public pool</span></div></div>
          <div className="rule-card"><LockKeyhole size={16}/><div><b>Cap enforced in allocation math</b><span>No wallet can receive more than {fmt(capAmount)} {symbol} in the public pool.</span></div></div>
          <div className="rule-card"><Gauge size={16}/><div><b>Pro-rata when oversubscribed</b><span>Excess demand is scaled proportionally instead of rewarding speed.</span></div></div>
        </aside>
      </section>}

      {tab==='proof' && <section className="proof-layout">
        <div className="panel"><div className="panel-head"><div><span className="kicker">03 / VERIFY</span><h2>Allocation proof</h2></div><span className="verified"><Check size={14}/> VERIFIABLE</span></div>
          <p className="muted">Nuvex hashes the exact launch parameters and commits the proof to a signed Solana transaction so the launch rules can be audited after the fact.</p>
          <div className="proof-block"><span>SHA-256 commitment</span><code>{proofHash||'Run a Devnet launch to generate the proof.'}</code>{proofHash&&<button onClick={copyProof}>{copied?<Check size={15}/>:<Copy size={15}/>}</button>}</div>
          {signature?<div className="onchain-card"><div className="check-ring"><Check size={20}/></div><div><b>Policy committed on Solana Devnet</b><span>Signed transaction contains the Nuvex fair-launch memo.</span></div><div className="onchain-actions"><a href={EXPLORER+'/tx/'+signature+'?cluster=devnet'} target="_blank" rel="noreferrer">View transaction <ExternalLink size={14}/></a><button onClick={verifyOnChainProof} disabled={verification==='checking'}>{verification==='checking'?<RefreshCw className="spin" size={14}/>:<ShieldCheck size={14}/>} {verification==='checking'?'Verifying...':'Verify on-chain'}</button></div></div>:<div className="empty-proof"><ShieldCheck size={30}/><b>No proof yet</b><span>Launch on Devnet to create the first verifiable artifact.</span><button onClick={()=>setTab('launch')}>Configure launch</button></div>}
          {verificationMessage&&<div className={'verification-result '+verification}>{verification=== 'verified'?<Check size={15}/>:<CircleHelp size={15}/>}<span>{verificationMessage}</span></div>}
          {mintAddress&&<div className="mint-row"><span>Mint</span><code>{mintAddress}</code><a href={EXPLORER+'/address/'+mintAddress+'?cluster=devnet'} target="_blank" rel="noreferrer">Explorer</a></div>}
        </div>
        <div className="panel"><div className="panel-head"><div><span className="kicker">ALLOCATION SAMPLE</span><h2>Oversubscription test</h2></div></div><div className="table"><div className="table-row head"><span>Wallet</span><span>Requested</span><span>Final</span></div>{sampleClaims.map(r=><div className="table-row" key={r.wallet}><span className="mono">{r.wallet}</span><span>{fmt(r.requested)}</span><b>{fmt(r.allocation)}</b></div>)}</div><div className="table-note"><ShieldCheck size={15}/> Deterministic <b>capped-pro-rata-v1</b> — same inputs produce the same result.</div></div>
      </section>}

      {tab==='protocol' && <section className="protocol-grid">
        <div className="panel"><div className="panel-head"><div><span className="kicker">04 / ENFORCE</span><h2>Fair Launch Program</h2></div><span className="step">ANCHOR / SOURCE</span></div>
          <div className="program-note"><b>Enforcement layer included</b><span>The Anchor program defines launch, funding, request, finalization and claim constraints. It is included for review; the hosted MVP has not deployed this Rust program.</span></div>
          <div className="protocol-flow"><div><b>01</b><span>Create launch</span><em>Store pool, cap and policy hash</em></div><ChevronRight/><div><b>02</b><span>Fund vault</span><em>Program-controlled token vault</em></div><ChevronRight/><div><b>03</b><span>Request</span><em>One participant PDA per wallet</em></div><ChevronRight/><div><b>04</b><span>Claim</span><em>Capped pro-rata transfer</em></div></div>
          <div className="security-list">{[['A','Program vault','Vault authority is a PDA; the creator cannot redirect claims.'],['B','Deterministic math','u128 multiplication protects the pro-rata calculation.'],['C','Request uniqueness','participant PDA = launch + wallet prevents duplicate requests.'],['D','Finalization','No new requests are accepted after the allocation epoch closes.']].map(x=><div key={x[0]}><span className="security-num">{x[0]}</span><div><b>{x[1]}</b><p>{x[2]}</p></div></div>)}</div>
          <div className="program-id"><span>Candidate Devnet program ID</span><code>4S92Ldnxea8FbFW3f2BaofVfqMDUbjScoq5Ks7tdKp19</code></div>
        </div>
        <div className="panel"><div className="panel-head"><div><span className="kicker">AUDIT STATUS</span><h2>What is live today</h2></div></div><div className="security-list"><div><span className="security-num">✓</span><div><b>Devnet SPL mint</b><p>Live browser flow creates and signs a real Devnet token transaction.</p></div></div><div><span className="security-num">✓</span><div><b>Policy commitment</b><p>SHA-256 launch policy is written into the Solana Memo program.</p></div></div><div><span className="security-num">✓</span><div><b>Direct verification</b><p>The app reads the confirmed transaction and checks the proof.</p></div></div><div><span className="security-num">→</span><div><b>Anchor enforcement</b><p>Source included; deployment requires an Anchor-capable environment.</p></div></div></div></div>
      </section>}

      {tab==='network' && <section className="analytics">
        <div className="metric"><span>Public allocation</span><strong>{publicPct}%</strong><em>of total supply</em></div>
        <div className="metric"><span>Wallet ceiling</span><strong>{walletCap}%</strong><em>of public pool</em></div>
        <div className="metric"><span>Expected participants</span><strong>{participants}</strong><em>launch model</em></div>
        <div className="metric"><span>Policy status</span><strong className={signature?'green':''}>{signature?'ON-CHAIN':'DRAFT'}</strong><em>{signature?'Devnet proof available':'awaiting launch'}</em></div>
        <div className="panel insight"><div className="insight-icon"><Zap size={20}/></div><div><span className="kicker">WHY NUVEX</span><h2>Make allocation rules part of the product.</h2><p>Most token launches expose a promise. Nuvex makes the promise machine-readable: a fixed allocation policy, a wallet ceiling, deterministic oversubscription math, and a public proof transaction.</p></div></div>
      </section>}
    </main>
    <footer><span>NUVEX NETWORK</span><span>Solana Devnet MVP · Fair Launch Engine v1</span><a href="https://github.com/nuvexnetwork-dev/nuvex-fair-launch" target="_blank" rel="noreferrer"><Github size={14}/> Source</a></footer>
  </div>;
}