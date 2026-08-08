'use client';

import { useState, useEffect } from 'react';
import { ShoppingBag, Sparkles, MessageSquare } from 'lucide-react';
import { useAppraisal } from '../hooks/useAppraisal';

interface CatalogItem {
  id: string;
  name: string;
  description: string;
  coinId: string;
  amount: string;
  decimals: number;
  stock: number;
  deliveryMessage: string;
}

export default function Home() {
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<CatalogItem | null>(null);
  const [appraisalModal, setAppraisalModal] = useState(false);

  // Form states for AI Appraisal
  const [pName, setPName] = useState('');
  const [category, setCategory] = useState('');
  const [condition, setCondition] = useState('used');
  const [askingPrice, setAskingPrice] = useState('');

  const { state: appraisalState, requestAppraisal, reset: resetAppraisal } = useAppraisal();

  useEffect(() => {
    fetch('/catalog.json')
      .then((res) => res.json())
      .then((data) => setCatalog(data))
      .catch((err) => console.error('Failed to load catalog:', err));
  }, []);

  const handleAppraisalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await requestAppraisal({
      productName: pName,
      category,
      condition,
      sellerPrice: Number(askingPrice),
    });
  };

  return (
    <div className="min-h-screen bg-[#0d0907] text-zinc-100 font-sans selection:bg-orange-500 selection:text-white">
      {/* Background Ambient Glow */}
      <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(circle_at_top,_var(--tw-gradient-stops))] from-orange-600/15 via-transparent to-transparent z-0" />

      {/* Header */}
      <header className="relative z-10 border-b border-amber-900/30 bg-[#120b08]/80 backdrop-blur-md sticky top-0">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="bg-gradient-to-tr from-amber-600 to-orange-500 p-2.5 rounded-xl text-zinc-950 font-bold shadow-lg shadow-orange-500/20">
              <ShoppingBag size={20} className="stroke-[2.5]" />
            </div>
            <div>
              <h1 className="font-bold text-lg leading-tight tracking-wide text-zinc-100 uppercase">
                Unicity <span className="text-orange-500">Shopfront</span>
              </h1>
              <p className="text-xs text-amber-200/50">Powered by Autonomous Sphere Agent</p>
            </div>
          </div>
          <div className="flex items-center space-x-4">
            <button
              onClick={() => setAppraisalModal(true)}
              className="flex items-center space-x-2 bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-400 hover:to-amber-500 text-zinc-950 font-bold px-4 py-2 rounded-xl text-xs uppercase tracking-wider shadow-lg shadow-orange-500/25 transition active:scale-95"
            >
              <Sparkles size={15} />
              <span>AI Price Check</span>
              <span className="text-[9px] bg-black/20 px-1.5 py-0.5 rounded-full ml-1">BETA</span>
            </button>
            <span className="text-xs bg-amber-500/10 text-orange-400 border border-amber-500/30 px-3 py-1.5 rounded-full font-mono">
              ● Network: testnet2
            </span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="relative z-10">
        {/* Hero */}
        <section className="max-w-6xl mx-auto px-6 py-14 text-center">
          <div className="inline-flex items-center space-x-2 bg-amber-950/40 border border-amber-500/30 px-4 py-1.5 rounded-full text-xs text-orange-400 mb-6 font-mono tracking-wide">
            <span>AGENTIC COMMERCE PORTAL</span>
          </div>
          <h2 className="text-4xl sm:text-6xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-amber-100 via-orange-200 to-amber-500 uppercase">
            Decentralized P2P Marketplace
          </h2>
          <p className="text-amber-200/60 max-w-xl mx-auto mt-4 text-sm sm:text-base leading-relaxed">
            Browse visual listings, request instant payment invoices via Sphere DMs, or check market fairness using GenLayer consensus.
          </p>
        </section>

        {/* Catalog Grid */}
        <main className="max-w-6xl mx-auto px-6 pb-24">
          <h3 className="text-lg font-bold text-amber-100 mb-6 uppercase tracking-wider flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full bg-orange-500 inline-block"></span>
            <span>Available Inventory</span>
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {catalog.map((item) => (
              <div
                key={item.id}
                className="bg-[#140e0a]/80 border border-amber-900/30 rounded-2xl p-6 hover:border-orange-500/50 transition duration-200 flex flex-col justify-between group shadow-xl hover:shadow-orange-500/5"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="font-bold text-lg text-zinc-100 group-hover:text-orange-400 transition">
                      {item.name}
                    </h4>
                    <span className="text-[11px] font-mono bg-amber-950/80 border border-amber-800/40 px-2.5 py-1 rounded-md text-orange-400 shrink-0">
                      {item.stock < 0 ? 'Unlimited' : `${item.stock} left`}
                    </span>
                  </div>
                  <p className="text-xs text-amber-200/50 mt-2.5 line-clamp-2 leading-relaxed">
                    {item.description}
                  </p>
                </div>

                <div className="mt-6 pt-4 border-t border-amber-900/20 flex items-center justify-between">
                  <div>
                    <div className="text-[10px] text-amber-200/40 uppercase tracking-widest font-semibold">Price</div>
                    <div className="text-lg font-bold text-orange-400 font-mono">
                      {Number(item.amount) / Math.pow(10, item.decimals)} {item.coinId}
                    </div>
                  </div>
                  <button
                    onClick={() => setSelectedItem(item)}
                    className="bg-zinc-900 hover:bg-orange-500 hover:text-zinc-950 text-amber-200/90 border border-amber-800/40 hover:border-orange-500 px-4 py-2 rounded-xl text-xs font-bold flex items-center space-x-2 transition duration-150"
                  >
                    <MessageSquare size={14} />
                    <span>Buy via DM</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </main>
      </div>

      {/* Buy Modal */}
      {selectedItem && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-[#140e0a] border border-amber-700/40 rounded-2xl max-w-md w-full p-6 shadow-2xl relative">
            <h3 className="text-xl font-bold text-zinc-100 mb-2">Order {selectedItem.name}</h3>
            <p className="text-xs text-amber-200/60 mb-5 leading-relaxed">
              To purchase this item directly through Unicity P2P Messaging, send a direct message to our store agent:
            </p>
            <div className="bg-[#0b0805] p-4 rounded-xl border border-amber-900/40 font-mono text-xs mb-5 space-y-2">
              <div className="text-zinc-400">1. Open Sphere Wallet</div>
              <div className="text-orange-400 font-bold">2. DM: @abbagigoo_shop</div>
              <div className="text-amber-300 font-bold">3. Type command: buy {selectedItem.id}</div>
            </div>
            <button
              onClick={() => setSelectedItem(null)}
              className="w-full bg-amber-600 hover:bg-amber-500 text-zinc-950 font-bold py-2.5 rounded-xl text-xs uppercase tracking-wider transition"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* AI Price Check Modal */}
      {appraisalModal && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-[#140e0a] border border-amber-700/40 rounded-2xl max-w-lg w-full p-6 shadow-2xl relative">
            <div className="flex items-center space-x-2 text-orange-400 mb-1">
              <Sparkles size={16} />
              <span className="text-xs font-bold uppercase tracking-widest">GenLayer Contract</span>
            </div>
            <h3 className="text-xl font-bold text-zinc-100 mb-1">Smart Price Check Appraisal</h3>
            <p className="text-[11px] text-amber-200/40 mb-5">
              Real write transaction on GenLayer Studionet — usually 15-45s, but this network is
              still in beta and can occasionally take several minutes under heavy load.
            </p>

            {appraisalState.phase === 'error' && (
              <div className="bg-red-950/40 border border-red-500/30 rounded-xl p-3 mb-4 text-xs text-red-300">
                {appraisalState.message}
              </div>
            )}
            {appraisalState.phase === 'timeout' && (
              <div className="bg-amber-950/40 border border-amber-500/30 rounded-xl p-3 mb-4 text-xs text-amber-300">
                Still waiting on validator consensus after {Math.round(appraisalState.elapsedMs / 1000)}s — Studionet may be under heavy load. You can try again shortly.
              </div>
            )}

            {appraisalState.phase !== 'complete' ? (
              <form onSubmit={handleAppraisalSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-amber-200/70 mb-1.5 uppercase tracking-wide">
                    Product Name
                  </label>
                  <input
                    type="text"
                    required
                    value={pName}
                    onChange={(e) => setPName(e.target.value)}
                    placeholder="e.g. Ledger Nano X"
                    className="w-full bg-[#0b0805] border border-amber-900/40 rounded-xl px-4 py-2.5 text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-orange-500"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-amber-200/70 mb-1.5 uppercase tracking-wide">
                      Category
                    </label>
                    <input
                      type="text"
                      required
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      placeholder="e.g. Hardware"
                      className="w-full bg-[#0b0805] border border-amber-900/40 rounded-xl px-4 py-2.5 text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-orange-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-amber-200/70 mb-1.5 uppercase tracking-wide">
                      Condition
                    </label>
                    <select
                      value={condition}
                      onChange={(e) => setCondition(e.target.value)}
                      className="w-full bg-[#0b0805] border border-amber-900/40 rounded-xl px-4 py-2.5 text-xs text-zinc-100 focus:outline-none focus:border-orange-500"
                    >
                      <option value="new">New</option>
                      <option value="used">Used</option>
                      <option value="refurbished">Refurbished</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-amber-200/70 mb-1.5 uppercase tracking-wide">
                    Asking Price ($)
                  </label>
                  <input
                    type="number"
                    required
                    value={askingPrice}
                    onChange={(e) => setAskingPrice(e.target.value)}
                    placeholder="e.g. 120"
                    className="w-full bg-[#0b0805] border border-amber-900/40 rounded-xl px-4 py-2.5 text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-orange-500"
                  />
                </div>
                <div className="flex justify-end space-x-3 pt-3">
                  <button
                    type="button"
                    onClick={() => setAppraisalModal(false)}
                    className="px-4 py-2 rounded-xl text-xs font-bold text-amber-200/50 hover:text-zinc-100 uppercase tracking-wider"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={appraisalState.phase === 'submitting' || appraisalState.phase === 'polling'}
                    className="bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-400 hover:to-amber-500 text-zinc-950 font-bold px-5 py-2.5 rounded-xl text-xs uppercase tracking-wider shadow-lg shadow-orange-500/20"
                  >
                    {appraisalState.phase === 'submitting' && <span>Submitting...</span>}
                    {appraisalState.phase === 'polling' && (
                      <span>Waiting for consensus ({Math.round(appraisalState.elapsedMs / 1000)}s)...</span>
                    )}
                    {(appraisalState.phase === 'idle' ||
                      appraisalState.phase === 'timeout' ||
                      appraisalState.phase === 'error') && <span>Request Appraisal</span>}
                  </button>
                </div>
              </form>
            ) : (
              <div className="space-y-4">
                <div className="bg-[#0b0805] p-5 rounded-xl border border-orange-500/30">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs text-amber-200/60 font-semibold uppercase tracking-wider">Verdict</span>
                    <span className="text-xs font-bold bg-orange-500/20 text-orange-400 border border-orange-500/30 px-2.5 py-0.5 rounded font-mono">
                      {appraisalState.phase === 'complete' && appraisalState.result.verdict}
                    </span>
                  </div>
                  <div className="text-base font-bold text-zinc-100 mb-1">
                    {appraisalState.phase === 'complete' && appraisalState.result.productName}
                  </div>
                  <div className="text-xs text-amber-400 font-mono">
                    {appraisalState.phase === 'complete' &&
                      `Est. Market Range: $${appraisalState.result.marketLow.toFixed(2)} - $${appraisalState.result.marketHigh.toFixed(2)}`}
                  </div>
                  <p className="text-xs text-amber-200/70 mt-3 border-t border-amber-900/30 pt-3 leading-relaxed">
                    {appraisalState.phase === 'complete' && appraisalState.result.reason}
                  </p>
                </div>
                <button
                  onClick={() => {
                    resetAppraisal();
                    setPName('');
                    setAskingPrice('');
                  }}
                  className="w-full bg-amber-600 hover:bg-amber-500 text-zinc-950 font-bold py-2.5 rounded-xl text-xs uppercase tracking-wider transition"
                >
                  Check Another Product
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}