/**
 * AutoDine — DEMO DATA for Phase 1 visual prototypes.
 *
 * Everything in this file is fabricated sample content used only so the design
 * alternatives can be judged with realistic content. It is NOT connected to any
 * database, API, payment provider, or real restaurant.
 *
 * No live payment service is invoked anywhere in these prototypes.
 */

export const inr = (n: number) =>
  '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });

export const restaurant = {
  name: 'Saffron & Smoke',
  tagline: 'Modern Indian kitchen · Nagpur',
  address: '14 Civil Lines, Near Zero Mile, Nagpur 440001, Maharashtra',
  phone: '+91 712 000 0000',
  gstin: 'GSTIN — add in Settings',
  fssai: 'FSSAI — add in Settings',
  currency: 'INR',
  openHours: '11:30 AM – 11:00 PM, daily',
  timezone: 'Asia/Kolkata',
};

export type ModifierGroup = {
  id: string;
  name: string;
  type: 'single' | 'multi';
  required?: boolean;
  /** How many may be picked. Absent means "all of them". */
  max?: number;
  options: { id: string; name: string; price: number }[];
};

export type Item = {
  id: string;
  name: string;
  desc: string;
  price: number;
  category: string;
  veg: boolean;
  spice?: 0 | 1 | 2;
  badge?: string;
  available: boolean;
  img?: string;
  variants?: { id: string; name: string; price: number }[];
  modifiers?: ModifierGroup[];
};

export const categories = [
  { id: 'starters', name: 'Starters', count: 6 },
  { id: 'tandoor', name: 'Tandoor & Grills', count: 5 },
  { id: 'curries', name: 'Curries & Mains', count: 8 },
  { id: 'biryani', name: 'Biryani & Rice', count: 5 },
  { id: 'breads', name: 'Breads', count: 6 },
  { id: 'desserts', name: 'Desserts', count: 5 },
  { id: 'drinks', name: 'Beverages', count: 8 },
];

const spiceLevels: ModifierGroup = {
  id: 'spice',
  name: 'Spice level',
  type: 'single',
  required: true,
  options: [
    { id: 'mild', name: 'Mild', price: 0 },
    { id: 'medium', name: 'Medium', price: 0 },
    { id: 'hot', name: 'Hot', price: 0 },
  ],
};

export const items: Item[] = [
  {
    id: 'it-paneer-tikka',
    name: 'Paneer Tikka',
    desc: 'Charred cottage cheese, ajwain marinade, bell pepper, red onion',
    price: 349,
    category: 'starters',
    veg: true,
    spice: 1,
    badge: 'Bestseller',
    available: true,
    img: '/img/dishes/paneer-tikka.jpg',
    variants: [
      { id: 'reg', name: 'Regular · 6 pcs', price: 349 },
      { id: 'share', name: 'Sharing · 12 pcs', price: 629 },
    ],
    modifiers: [
      spiceLevels,
      {
        id: 'addons',
        name: 'Add-ons',
        type: 'multi',
        options: [
          { id: 'mint', name: 'Extra mint chutney', price: 30 },
          { id: 'salad', name: 'Onion salad', price: 40 },
        ],
      },
    ],
  },
  {
    id: 'it-hara-bhara',
    name: 'Hara Bhara Kebab',
    desc: 'Spinach, green pea and potato patty, toasted cashew centre',
    price: 299,
    category: 'starters',
    veg: true,
    available: true,
    img: '/img/dishes/hara-bhara-kebab.jpg',
  },
  {
    id: 'it-chicken-malai',
    name: 'Chicken Malai Tikka',
    desc: 'Cream, cheddar and cardamom marinade, finished in the tandoor',
    price: 429,
    category: 'starters',
    veg: false,
    spice: 0,
    available: true,
    img: '/img/dishes/chicken-malai-tikka.jpg',
    modifiers: [spiceLevels],
  },
  {
    id: 'it-tandoori',
    name: 'Tandoori Chicken',
    desc: 'Kashmiri chilli and yoghurt marinade, served with mint chutney',
    price: 349,
    category: 'tandoor',
    veg: false,
    spice: 2,
    available: true,
    img: '/img/dishes/tandoori-chicken.jpg',
    variants: [
      { id: 'half', name: 'Half · 4 pcs', price: 349 },
      { id: 'full', name: 'Full · 8 pcs', price: 649 },
    ],
    modifiers: [spiceLevels],
  },
  {
    id: 'it-seekh',
    name: 'Seekh Kebab',
    desc: 'Hand-minced lamb, green chilli and warm spices, iron skewer',
    price: 459,
    category: 'tandoor',
    veg: false,
    spice: 2,
    available: true,
    img: '/img/dishes/seekh-kebab.jpg',
  },
  {
    id: 'it-butter-chicken',
    name: 'Butter Chicken',
    desc: 'Tandoor-cooked chicken in a tomato, cashew and butter gravy',
    price: 469,
    category: 'curries',
    veg: false,
    spice: 1,
    badge: "Chef's pick",
    available: true,
    img: '/img/dishes/butter-chicken.jpg',
    variants: [
      { id: 'reg', name: 'Regular · 4 pcs', price: 469 },
      { id: 'share', name: 'Sharing · 8 pcs', price: 849 },
    ],
    modifiers: [
      spiceLevels,
      {
        id: 'bread',
        name: 'Pair it with',
        type: 'single',
        options: [
          { id: 'none', name: 'No bread', price: 0 },
          { id: 'naan', name: 'Butter naan', price: 79 },
          { id: 'roti', name: 'Tandoori roti', price: 59 },
        ],
      },
    ],
  },
  {
    id: 'it-dal-bukhara',
    name: 'Dal Bukhara',
    desc: 'Black urad slow-cooked 18 hours, tomato, ghee, kasuri methi',
    price: 389,
    category: 'curries',
    veg: true,
    available: true,
    img: '/img/dishes/dal-bukhara.jpg',
  },
  {
    id: 'it-paneer-butter',
    name: 'Paneer Butter Masala',
    desc: 'Fresh paneer in a fenugreek-scented tomato and cashew gravy',
    price: 399,
    category: 'curries',
    veg: true,
    spice: 1,
    available: true,
    img: '/img/dishes/paneer-butter-masala.jpg',
    variants: [
      { id: 'reg', name: 'Regular', price: 399 },
      { id: 'share', name: 'Sharing', price: 729 },
    ],
  },
  {
    id: 'it-laal-maas',
    name: 'Laal Maas',
    desc: 'Mathania chilli lamb curry, smoked ghee',
    price: 549,
    category: 'curries',
    veg: false,
    spice: 2,
    badge: 'Sold out',
    available: false,
    img: '/img/dishes/laal-maas.jpg',
  },
  {
    id: 'it-biryani-chicken',
    name: 'Hyderabadi Chicken Biryani',
    desc: 'Kacchi-style dum biryani, saffron, fried onion, served with salan',
    price: 499,
    category: 'biryani',
    veg: false,
    spice: 2,
    badge: 'Bestseller',
    available: true,
    img: '/img/dishes/hyderabadi-chicken-biryani.jpg',
    modifiers: [
      spiceLevels,
      {
        id: 'biryani-addons',
        name: 'Add-ons',
        type: 'multi',
        options: [
          { id: 'raita', name: 'Boondi raita', price: 40 },
          { id: 'salan', name: 'Extra salan', price: 60 },
          { id: 'egg', name: 'Boiled egg', price: 30 },
        ],
      },
    ],
  },
  {
    id: 'it-biryani-veg',
    name: 'Subz Dum Biryani',
    desc: 'Seasonal vegetables, saffron rice, dum-sealed handi',
    price: 379,
    category: 'biryani',
    veg: true,
    available: true,
    img: '/img/dishes/subz-dum-biryani.jpg',
  },
  {
    id: 'it-masala-dosa',
    name: 'Masala Dosa',
    desc: 'Crisp fermented crepe, potato masala, coconut chutney, sambar',
    price: 249,
    category: 'biryani',
    veg: true,
    available: true,
    img: '/img/dishes/masala-dosa.jpg',
  },
  { id: 'it-naan', name: 'Butter Naan', desc: 'Tandoor-baked, brushed with butter', price: 79, category: 'breads', veg: true, available: true, img: '/img/dishes/butter-naan.jpg' },
  { id: 'it-garlic-naan', name: 'Garlic Naan', desc: 'Fresh garlic and coriander', price: 99, category: 'breads', veg: true, available: true , img: '/img/dishes/garlic-naan.jpg' },
  { id: 'it-roti', name: 'Tandoori Roti', desc: 'Whole wheat, tandoor-fired', price: 59, category: 'breads', veg: true, available: true , img: '/img/dishes/tandoori-roti.jpg' },
  { id: 'it-paratha', name: 'Laccha Paratha', desc: 'Layered, flaky, brushed with ghee', price: 89, category: 'breads', veg: true, available: true , img: '/img/dishes/laccha-paratha.jpg' },
  { id: 'it-gulab', name: 'Gulab Jamun', desc: 'Two warm dumplings, cardamom syrup', price: 149, category: 'desserts', veg: true, available: true , img: '/img/dishes/gulab-jamun.jpg' },
  { id: 'it-rasmalai', name: 'Rasmalai', desc: 'Chhena discs in saffron-scented milk', price: 179, category: 'desserts', veg: true, available: true , img: '/img/dishes/rasmalai.jpg' },
  { id: 'it-chai', name: 'Masala Chai', desc: 'Assam leaf, ginger, cardamom, single estate', price: 99, category: 'drinks', veg: true, available: true , img: '/img/dishes/masala-chai.jpg' },
  { id: 'it-lassi', name: 'Mango Lassi', desc: 'Alphonso pulp, hung curd, lightly sweetened', price: 149, category: 'drinks', veg: true, available: true , img: '/img/dishes/mango-lassi.jpg' },
  { id: 'it-lime', name: 'Fresh Lime Soda', desc: 'Sweet or salted, soda, mint', price: 119, category: 'drinks', veg: true, available: true , img: '/img/dishes/fresh-lime-soda.jpg' },
  {
    id: 'it-coffee',
    name: 'Filter Coffee',
    desc: 'Degree coffee decoction, froth-pulled, served in a dabarah',
    price: 109,
    category: 'drinks',
    veg: true,
    available: true,
    img: '/img/dishes/filter-coffee.jpg',
    variants: [
      { id: 'small', name: 'Regular', price: 109 },
      { id: 'large', name: 'Large', price: 149 },
    ],
  },
];

export type KitchenOrder = {
  id: string;
  table: string;
  placedAt: string;
  ageMin: number;
  payment: 'paid' | 'pending' | 'failed';
  paymentMethod?: string;
  state: 'new' | 'preparing' | 'ready' | 'served';
  note?: string;
  items: { qty: number; name: string; detail?: string; veg: boolean }[];
  total: number;
};

export const kitchenOrders: KitchenOrder[] = [
  {
    id: 'A-1042',
    table: 'T7',
    placedAt: '12:42 PM',
    ageMin: 4,
    payment: 'paid',
    paymentMethod: 'UPI · paid online',
    state: 'new',
    note: 'Ring the bell when biryani leaves the pass.',
    items: [
      { qty: 1, name: 'Butter Chicken', detail: 'Regular · Hot · Butter naan', veg: false },
      { qty: 2, name: 'Butter Naan', veg: true },
      { qty: 1, name: 'Mango Lassi', veg: true },
    ],
    total: 776,
  },
  {
    id: 'A-1041',
    table: 'T3',
    placedAt: '12:38 PM',
    ageMin: 8,
    payment: 'pending',
    paymentMethod: 'Pay at counter',
    state: 'preparing',
    items: [
      { qty: 2, name: 'Hyderabadi Chicken Biryani', detail: 'Hot · Boondi raita', veg: false },
      { qty: 3, name: 'Tandoori Roti', veg: true },
    ],
    total: 1247,
  },
  {
    id: 'A-1040',
    table: 'T12',
    placedAt: '12:31 PM',
    ageMin: 15,
    payment: 'paid',
    paymentMethod: 'Card · paid online',
    state: 'ready',
    items: [
      { qty: 1, name: 'Paneer Tikka', detail: 'Sharing · Medium · Extra mint chutney', veg: true },
      { qty: 4, name: 'Laccha Paratha', veg: true },
    ],
    total: 985,
  },
  {
    id: 'A-1039',
    table: 'T5',
    placedAt: '12:24 PM',
    ageMin: 22,
    payment: 'paid',
    paymentMethod: 'UPI · paid online',
    state: 'served',
    items: [
      { qty: 1, name: 'Dal Bukhara', veg: true },
      { qty: 3, name: 'Garlic Naan', veg: true },
      { qty: 2, name: 'Masala Chai', veg: true },
    ],
    total: 864,
  },
  {
    id: 'A-1038',
    table: 'T9',
    placedAt: '12:19 PM',
    ageMin: 27,
    payment: 'pending',
    paymentMethod: 'Pay at counter',
    state: 'ready',
    items: [
      { qty: 1, name: 'Subz Dum Biryani', veg: true },
      { qty: 2, name: 'Rasmalai', veg: true },
    ],
    total: 737,
  },
];

export const counterQueue = [
  {
    id: 'A-1041',
    table: 'T3',
    at: '12:38 PM',
    state: 'Preparing',
    method: 'Pay at counter',
    total: 1247,
    items: '2 × Chicken Biryani · 3 × Tandoori Roti',
  },
  {
    id: 'A-1038',
    table: 'T9',
    at: '12:19 PM',
    state: 'Ready',
    method: 'Pay at counter',
    total: 737,
    items: '1 × Subz Dum Biryani · 2 × Rasmalai',
  },
  {
    id: 'A-1036',
    table: 'T2',
    at: '12:04 PM',
    state: 'Served',
    method: 'Pay at counter',
    total: 2180,
    items: '6 items · 1 × Tandoori Chicken (Full)',
  },
];

export type TableRow = {
  code: string;
  label: string;
  seats: number;
  qr: 'active' | 'printed' | 'revoked' | 'disabled';
  lastScan: string;
  orders: number;
};

export const tables: TableRow[] = [
  { code: 'T1', label: 'Window · 2 seater', seats: 2, qr: 'active', lastScan: '2 min ago', orders: 3 },
  { code: 'T2', label: 'Window · 4 seater', seats: 4, qr: 'active', lastScan: '18 min ago', orders: 1 },
  { code: 'T3', label: 'Main floor', seats: 4, qr: 'active', lastScan: 'just now', orders: 2 },
  { code: 'T4', label: 'Main floor', seats: 4, qr: 'printed', lastScan: '1 h ago', orders: 0 },
  { code: 'T5', label: 'Main floor', seats: 6, qr: 'active', lastScan: '24 min ago', orders: 4 },
  { code: 'T6', label: 'Corner booth', seats: 6, qr: 'active', lastScan: '6 min ago', orders: 2 },
  { code: 'T7', label: 'Corner booth', seats: 4, qr: 'active', lastScan: 'just now', orders: 1 },
  { code: 'T8', label: 'Mezzanine', seats: 2, qr: 'revoked', lastScan: '3 days ago', orders: 0 },
  { code: 'T9', label: 'Mezzanine', seats: 4, qr: 'active', lastScan: '27 min ago', orders: 2 },
  { code: 'T10', label: 'Outdoor', seats: 4, qr: 'active', lastScan: '41 min ago', orders: 1 },
  { code: 'T11', label: 'Outdoor', seats: 6, qr: 'disabled', lastScan: '—', orders: 0 },
  { code: 'T12', label: 'Private dining', seats: 10, qr: 'active', lastScan: '15 min ago', orders: 5 },
];

export const staff = [
  { name: 'Aryan Patel', role: 'Owner', scope: 'Full access', last: 'Active now', initials: 'AP' },
  { name: 'Meera Iyer', role: 'Manager', scope: 'Orders, menu, reports', last: '2 h ago', initials: 'MI' },
  { name: 'Rohan Kulkarni', role: 'Kitchen', scope: 'Kitchen board only', last: 'Active now', initials: 'RK' },
  { name: 'Sana Qureshi', role: 'Cashier', scope: 'Payments & receipts', last: 'Yesterday', initials: 'SQ' },
];

export const dashboardStats = [
  { label: 'Orders today', value: '128', delta: '+12% vs last Wed', trend: 'up' },
  { label: 'Revenue today', value: inr(184320), delta: '+8% vs last Wed', trend: 'up' },
  { label: 'Average ticket', value: inr(1440), delta: '−₹60 vs last Wed', trend: 'down' },
  { label: 'Avg prep time', value: '14 min', delta: '−2 min vs last Wed', trend: 'up' },
];

export const sparkline = [38, 44, 30, 52, 61, 48, 70, 66, 84, 78, 92, 88];

export const topItems = [
  { name: 'Butter Chicken', sold: 46, revenue: 21574 },
  { name: 'Hyderabadi Chicken Biryani', sold: 38, revenue: 18962 },
  { name: 'Paneer Tikka', sold: 31, revenue: 10819 },
  { name: 'Garlic Naan', sold: 88, revenue: 8712 },
  { name: 'Mango Lassi', sold: 42, revenue: 6258 },
];

export const recentOrders = [
  { id: 'A-1042', table: 'T7', at: '12:42 PM', total: 776, payment: 'Paid online', state: 'New' },
  { id: 'A-1041', table: 'T3', at: '12:38 PM', total: 1247, payment: 'Counter due', state: 'Preparing' },
  { id: 'A-1040', table: 'T12', at: '12:31 PM', total: 985, payment: 'Paid online', state: 'Ready' },
  { id: 'A-1039', table: 'T5', at: '12:24 PM', total: 864, payment: 'Paid online', state: 'Served' },
  { id: 'A-1038', table: 'T9', at: '12:19 PM', total: 737, payment: 'Counter due', state: 'Ready' },
];
