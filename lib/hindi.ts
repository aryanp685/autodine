/**
 * Devanagari for the voice.
 *
 * WHY EVERY WORD HAS TO BE DEVANAGARI
 *
 * A Hindi voice is asked to read the ticket. The ticket contains a table
 * label, quantities, portions -- and dish names, which an Indian restaurant
 * almost always writes in Latin script ("Butter Chicken", "Paneer Tikka").
 *
 * Speech engines disagree about Latin text inside a Hindi utterance. Google's
 * हिन्दी voice reads it as English and carries on. Microsoft Swara does the
 * same. But an older or offline hi-IN engine (the eSpeak-derived ones that
 * ship on cheap Android tablets, and the compact voices on some laptops)
 * silently SKIPS the Latin run -- so "दो Butter Chicken" comes out as "दो",
 * the kitchen hears nothing to cook, and the engine reports success. That is
 * the exact failure this file removes: after toDevanagari(), the entire
 * sentence is Devanagari, and every engine reads every word of it.
 *
 * HOW A LATIN WORD IS TURNED INTO DEVANAGARI
 *
 * Menus are not English literature; they are a small, repetitive vocabulary.
 * So the dictionary below is the primary path, longest phrase first -- "gulab
 * jamun", "butter chicken", "dal makhani" are single entries, because a
 * word-by-word transliteration of a dish name is how you get "बटर चिकन" read
 * as two unrelated words.
 *
 * Anything not in the dictionary falls back to rules. The rules are a
 * Hinglish transliteration, not an English one: they are right for the way
 * these words are actually pronounced in an Indian kitchen (tikka -> टिक्का,
 * paneer -> पनीर, naan -> नान). A word the rules get slightly wrong is still
 * spoken; a word left in Latin script may not be spoken at all.
 *
 * The board shows the exact sentence it will speak, so the owner can see the
 * transliteration rather than discovering it by ear.
 */

/* ========================================================================== */
/*  Numbers                                                                   */
/* ========================================================================== */

/**
 * Hindi counts zero to ninety-nine with a separate word for every number --
 * there is no tidy tens-plus-units rule the way English has. They are spelled
 * out here rather than left as digits because a synthesiser reading "25" picks
 * its own preference (some say "पच्चीस", some spell "two five"), and a
 * quantity is the one number on a ticket a cook must never mishear.
 */
const HI_NUMBERS: readonly string[] = [
  'शून्य', 'एक', 'दो', 'तीन', 'चार', 'पाँच', 'छह', 'सात', 'आठ', 'नौ',
  'दस', 'ग्यारह', 'बारह', 'तेरह', 'चौदह', 'पंद्रह', 'सोलह', 'सत्रह', 'अठारह', 'उन्नीस',
  'बीस', 'इक्कीस', 'बाईस', 'तेईस', 'चौबीस', 'पच्चीस', 'छब्बीस', 'सत्ताईस', 'अट्ठाईस', 'उनतीस',
  'तीस', 'इकतीस', 'बत्तीस', 'तैंतीस', 'चौंतीस', 'पैंतीस', 'छत्तीस', 'सैंतीस', 'अड़तीस', 'उनतालीस',
  'चालीस', 'इकतालीस', 'बयालीस', 'तैंतालीस', 'चवालीस', 'पैंतालीस', 'छियालीस', 'सैंतालीस', 'अड़तालीस', 'उनचास',
  'पचास', 'इक्यावन', 'बावन', 'तिरपन', 'चौवन', 'पचपन', 'छप्पन', 'सत्तावन', 'अट्ठावन', 'उनसठ',
  'साठ', 'इकसठ', 'बासठ', 'तिरसठ', 'चौंसठ', 'पैंसठ', 'छियासठ', 'सड़सठ', 'अड़सठ', 'उनहत्तर',
  'सत्तर', 'इकहत्तर', 'बहत्तर', 'तिहत्तर', 'चौहत्तर', 'पचहत्तर', 'छिहत्तर', 'सतहत्तर', 'अठहत्तर', 'उन्नासी',
  'अस्सी', 'इक्यासी', 'बयासी', 'तिरासी', 'चौरासी', 'पचासी', 'छियासी', 'सत्तासी', 'अट्ठासी', 'नवासी',
  'नब्बे', 'इक्यानवे', 'बानवे', 'तिरानवे', 'चौरानवे', 'पचानवे', 'छियानवे', 'सत्तानवे', 'अट्ठानवे', 'निन्यानवे',
];

/**
 * A number as a Hindi word.
 *
 * Up to ninety-nine there is a word for it. Above that the number is read
 * digit by digit, which is how a large count is said aloud in a kitchen
 * anyway ("one two five plates") and is far more reliable than composing
 * "एक सौ पच्चीस" and hoping the engine agrees.
 */
export function hindiNumber(n: number): string {
  const rounded = Math.round(n);
  if (!Number.isFinite(rounded) || rounded < 0) return String(n);
  if (rounded < 100) return HI_NUMBERS[rounded];
  return [...String(rounded)].map((digit) => HI_NUMBERS[Number(digit)] ?? digit).join(' ');
}

/* ========================================================================== */
/*  Words                                                                     */
/* ========================================================================== */

/**
 * Menu vocabulary, as it is said in Hindi.
 *
 * Longest phrase first when matching, so "butter chicken" is not read as
 * "butter" + "chicken". Keys are lower case; matching ignores case.
 *
 * A restaurant that already writes its menu in Devanagari needs none of this
 * -- toDevanagari leaves Devanagari untouched, which is the common case for
 * the dishes whose names have no English form at all (पाव भाजी).
 */
const WORDS: Record<string, string> = {
  // ---- dishes and staples
  'butter chicken': 'बटर चिकन',
  'butter naan': 'बटर नान',
  'dal makhani': 'दाल मखनी',
  'dal fry': 'दाल फ्राई',
  'dal tadka': 'दाल तड़का',
  'paneer tikka': 'पनीर टिक्का',
  'paneer butter masala': 'पनीर बटर मसाला',
  'chicken tikka': 'चिकन टिक्का',
  'chicken biryani': 'चिकन बिरयानी',
  'hyderabadi chicken biryani': 'हैदराबादी चिकन बिरयानी',
  'veg biryani': 'वेज बिरयानी',
  'gulab jamun': 'गुलाब जामुन',
  'rasgulla': 'रसगुल्ला',
  'rasmalai': 'रसमलाई',
  'jeera rice': 'जीरा राइस',
  'veg pulao': 'वेज पुलाव',
  'gobi manchurian': 'गोबी मंचूरियन',
  'paneer butter': 'पनीर बटर',
  'tandoori chicken': 'तंदूरी चिकन',
  'chilli chicken': 'चिल्ली चिकन',
  'chili chicken': 'चिली चिकन',
  'butter roti': 'बटर रोटी',
  'masala dosa': 'मसाला डोसा',
  'plain dosa': 'प्लेन डोसा',
  'idli sambar': 'इडली सांबार',
  'pav bhaji': 'पाव भाजी',
  'chole bhature': 'छोले भटूरे',
  'veg thali': 'वेज थाली',
  'shahi paneer': 'शाही पनीर',
  'malai kofta': 'मलाई कोफ़्ता',
  'palak paneer': 'पालक पनीर',
  'kadhai paneer': 'कड़ाही पनीर',
  'soya chaap': 'सोया चाप',
  'rogan josh': 'रोगन जोश',
  'dum biryani': 'दम बिरयानी',
  'egg curry': 'एग करी',
  'fish curry': 'फ़िश करी',
  'prawn curry': 'प्रॉन करी',
  'mutton curry': 'मटन करी',
  'chicken curry': 'चिकन करी',
  'chicken tikka masala': 'चिकन टिक्का मसाला',
  'paneer makhani': 'पनीर मखनी',
  'jeera aloo': 'जीरा आलू',
  'aloo paratha': 'आलू पराठा',
  'paneer paratha': 'पनीर पराठा',
  'laccha paratha': 'लच्छा पराठा',
  'lachha paratha': 'लच्छा पराठा',
  'rumali roti': 'रुमाली रोटी',
  'missi roti': 'मिस्सी रोटी',
  'tandoori roti': 'तंदूरी रोटी',
  'laccha': 'लच्छा', 'lachha': 'लच्छा', 'rumali': 'रुमाली', 'missi': 'मिस्सी',
  'bhindi': 'भिंडी', 'karela': 'करेला', 'lauki': 'लौकी', 'baingan': 'बैंगन',
  'haleem': 'हलीम', 'nihari': 'निहारी', 'paya': 'पाया', 'keema': 'कीमा', 'kheema': 'कीमा',
  'bhuna': 'भुना', 'tawa': 'तवा', 'sizzler': 'सिज़लर', 'malai': 'मलाई',
  'navratan': 'नवरतन', 'dum': 'दम', 'matka': 'मटका', 'sharing': 'शेयरिंग',
  'bajra': 'बाजरा', 'jowar': 'ज्वार', 'ragi': 'रागी',
  'subz': 'सब्ज़', 'bukhara': 'बुख़ारा', 'dal bukhara': 'दाल बुख़ारा', 'garlic naan': 'लहसुन नान',
  'chicken thali': 'चिकन थाली',
  'boondi raita': 'बूंदी रायता',
  'mint chutney': 'मिंट चटनी',
  'green chutney': 'हरी चटनी',
  'sweet lassi': 'स्वीट लस्सी',
  'mango lassi': 'मैंगो लस्सी',
  'masala chai': 'मसाला चाय',
  'filter coffee': 'फिल्टर कॉफ़ी',
  'cold coffee': 'कोल्ड कॉफ़ी',
  'hot water': 'गरम पानी',
  'mineral water': 'मिनरल वाटर',
  'soft drink': 'कोल्ड ड्रिंक',

  // ---- dish words
  'chicken': 'चिकन', 'mutton': 'मटन', 'fish': 'फ़िश', 'prawn': 'प्रॉन', 'prawns': 'प्रॉन',
  'egg': 'एग', 'eggs': 'एग', 'paneer': 'पनीर', 'tofu': 'टोफ़ू', 'soya': 'सोया',
  'biryani': 'बिरयानी', 'pulao': 'पुलाव', 'rice': 'राइस', 'naan': 'नान', 'roti': 'रोटी',
  'paratha': 'पराठा', 'parotta': 'परोटा', 'kulcha': 'कुलचा', 'bhature': 'भटूरे', 'puri': 'पूरी',
  'dosa': 'डोसा', 'idli': 'इडली', 'vada': 'वड़ा', 'sambar': 'सांबार', 'uttapam': 'उत्तपम',
  'upma': 'उपमा', 'poha': 'पोहा', 'samosa': 'समोसा', 'pakora': 'पकोड़ा', 'kebab': 'कबाब',
  'seekh': 'सीख', 'tikka': 'टिक्का', 'tandoori': 'तंदूरी', 'curry': 'करी', 'masala': 'मसाला',
  'makhani': 'मखनी', 'kadai': 'कड़ाही', 'handi': 'हांडी', 'kolhapuri': 'कोल्हापुरी',
  'manchurian': 'मंचूरियन', 'schezwan': 'शेज़वान', 'hakka': 'हक्का', 'noodles': 'नूडल्स',
  'chowmein': 'चाउमीन', 'chow': 'चाउ', 'mein': 'मीन', 'momos': 'मोमोज़', 'momo': 'मोमो',
  'burger': 'बर्गर', 'pizza': 'पिज़्ज़ा', 'pasta': 'पास्ता', 'sandwich': 'सैंडविच',
  'fries': 'फ़्राइज़', 'soup': 'सूप', 'salad': 'सलाद', 'papad': 'पापड़', 'raita': 'रायता',
  'pickle': 'अचार', 'achar': 'अचार', 'thali': 'थाली', 'combo': 'कॉम्बो', 'platter': 'प्लेटर',
  'dal': 'दाल', 'daal': 'दाल', 'sabzi': 'सब्ज़ी', 'subzi': 'सब्ज़ी', 'bhaji': 'भाजी',
  'aloo': 'आलू', 'potato': 'आलू', 'gobi': 'गोबी', 'matar': 'मटर', 'chana': 'चना',
  'rajma': 'राजमा', 'chole': 'छोले', 'cholay': 'छोले', 'kadhi': 'कढ़ी', 'korma': 'कोरमा',
  'kofta': 'कोफ़्ता', 'tikkaa': 'टिक्का', 'chaap': 'चाप', 'chaat': 'चाट', 'kachori': 'कचौरी',
  'dhokla': 'ढोकला', 'thepla': 'थेपला', 'khichdi': 'खिचड़ी', 'maggi': 'मैगी',
  'cheese': 'चीज़', 'corn': 'कॉर्न', 'mushroom': 'मशरूम', 'spinach': 'पालक', 'palak': 'पालक',
  'onion': 'प्याज़', 'tomato': 'टमाटर', 'garlic': 'लहसुन', 'ginger': 'अदरक',
  'coriander': 'धनिया', 'coconut': 'नारियल', 'cashew': 'काजू', 'almond': 'बादाम',
  'saffron': 'केसर', 'cardamom': 'इलायची', 'sugar': 'शुगर', 'salt': 'नमक',
  'bread': 'ब्रेड', 'toast': 'टोस्ट', 'butter': 'बटर', 'ghee': 'घी', 'oil': 'तेल', 'curd': 'दही',
  'ice cream': 'आइस क्रीम', 'ice': 'बर्फ़', 'cream': 'क्रीम', 'dessert': 'डेज़र्ट', 'sweet': 'स्वीट',
  'lassi': 'लस्सी', 'chai': 'चाय', 'tea': 'चाय', 'coffee': 'कॉफ़ी', 'water': 'वाटर',
  'coke': 'कोक', 'pepsi': 'पेप्सी', 'sprite': 'स्प्राइट', 'lemonade': 'लेमनाड',
  'lemon': 'लेमन', 'lime': 'लाइम', 'soda': 'सोडा', 'juice': 'जूस', 'shake': 'शेक',
  'thums': 'थम्स', 'up': 'अप', 'beer': 'बियर',
  'mojito': 'मोजितो', 'brownie': 'ब्राउनी', 'cake': 'केक',
  'pancake': 'पैनकेक', 'waffle': 'वफ़ल', 'nachos': 'नाचोज़', 'taco': 'टाको',
  'salsa': 'साल्सा', 'dip': 'डिप', 'sauce': 'सॉस', 'ketchup': 'केचप', 'mayo': 'मेयो',
  'fried rice': 'फ़्राइड राइस', 'peri peri fries': 'पेरी पेरी फ़्राइज़',
  'chicken lollipop': 'चिकन लोलीपॉप', 'lollipop': 'लोलीपॉप',
  'cappuccino': 'कैपुचीनो', 'espresso': 'एस्प्रेसो', 'latte': 'लाते',
  'mozzarella': 'मोज़रेला', 'maple syrup': 'मेपल सिरप',
  // Pizza names are spelled the way they are said, not the way they are
  // printed: the rule engine turned "Margherita" into मैर्घेरिटा, which is
  // not a word in any language.
  'margherita': 'मार्गेरिटा', 'pepperoni': 'पेपरोनी', 'farmhouse': 'फ़ार्महाउस',

  // ---- how a dish is ordered
  'half': 'आधा', 'full': 'पूरा', 'quarter': 'पाव', 'regular': 'रेगुलर', 'small': 'छोटा',
  'medium': 'मीडियम', 'large': 'बड़ा', 'single': 'सिंगल', 'double': 'डबल', 'plate': 'प्लेट',
  'bowl': 'बाउल', 'cup': 'कप', 'glass': 'ग्लास', 'bottle': 'बोतल', 'piece': 'पीस',
  'pieces': 'पीस', 'extra': 'एक्स्ट्रा', 'plain': 'प्लेन', 'special': 'स्पेशल',
  'fresh': 'फ़्रेश', 'hot': 'गरम', 'cold': 'ठंडा', 'spicy': 'तीखा', 'mild': 'माइल्ड',
  'salty': 'नमकीन', 'dry': 'ड्राई', 'gravy': 'ग्रेवी',

  // ---- the guest's note
  'no': 'नो', 'without': 'विदाउट', 'less': 'कम', 'more': 'ज़्यादा', 'please': 'प्लीज़',
  'allergy': 'एलर्जी', 'allergic': 'एलर्जिक', 'jain': 'जैन', 'vegan': 'वीगन', 'fasting': 'व्रत',

  // ---- the board's own words
  'order': 'ऑर्डर', 'table': 'टेबल', 'takeaway': 'टेकअवे', 'counter': 'काउंटर',
  'cancelled': 'कैंसल', 'canceled': 'कैंसल', 'pending': 'पेंडिंग', 'waited': 'इंतज़ार',
  'waiting': 'इंतज़ार', 'returned': 'वापस', 'refunded': 'रिफ़ंड', 'paid': 'पेड',
  'guest': 'गेस्ट', 'note': 'नोट', 'item': 'आइटम', 'items': 'आइटम',

  // ---- English a menu actually uses (rules would guess; these are known)
  'normal': 'नॉर्मल', 'total': 'टोटल', 'model': 'मॉडल',
  'local': 'लोकल', 'signal': 'सिग्नल', 'menu': 'मेन्यू',
  'chocolate': 'चॉकलेट', 'pudding': 'पुडिंग', 'family': 'फ़ैमिली',
  'pack': 'पैक', 'jumbo': 'जंबो', 'mini': 'मिनी',
  'kids': 'किड्स', 'meal': 'मील', 'premium': 'प्रीमियम',
  'classic': 'क्लासिक', 'grilled': 'ग्रिल्ड', 'crispy': 'क्रिस्पी',
  'crunchy': 'क्रंची', 'creamy': 'क्रीमी', 'tangy': 'टैंगी',
  'loaded': 'लोडेड', 'signature': 'सिग्नेचर', 'quesadilla': 'क़ेसाडिया',
  'tiramisu': 'टिरामिसू',
  'sizzling': 'सिज़लिंग', 'serving': 'सर्विंग', 'canned': 'कैन्ड',
  'sundae': 'संडे', 'smoothie': 'स्मूदी',
  'muffin': 'मफ़िन', 'donut': 'डोनट', 'cookie': 'कुकी',
};

/** Sorted longest-first, so a phrase wins over the words inside it. */
const PHRASES: readonly string[] = Object.keys(WORDS).sort((a, b) => b.length - a.length);

/* ========================================================================== */
/*  Rules, for the words the dictionary does not know                         */
/* ========================================================================== */

/**
 * A Latin word as Devanagari, by rule.
 *
 * The dictionary above covers the vocabulary a kitchen actually uses. What is
 * left is mostly English -- "normal", "small", "family pack", "brownie" -- and
 * this is where "readable" and "right" part company.
 *
 * The failure that made this rewrite necessary: "normal" came out as नोरमाल,
 * which a Hindi voice reads as "normaal". Every vowel was written long because
 * the rules did not know the word was English. So the rules now follow the
 * handful of things English spelling actually does:
 *
 *   English short o      "normal"    -> नॉर्मल      (नोरमाल is "normaal")
 *   unstressed final a   "total"     -> टोटल       (टोटाल is "totaal")
 *   closed short a       "cap"       -> कैप
 *   consonant + le       "bottle"    -> बोटल       (बोट्ल stumbles)
 *   silent final e       "coke"      -> कोक
 *   magic e              "cake"      -> केक
 *   c/g before e, i, y   "cappuccino"-> कैपुचीनो
 *   doubled consonants   "butter"    -> बटर        (बट्टर over-stresses)
 *
 * It is still a rule, and a rule is still a guess. Anything an owner cares
 * about belongs in the dictionary -- or in the "spoken name" field, which wins
 * over all of this. The menu editor names the words that were guessed.
 *
 * These rules apply ONLY to words the dictionary does not know: a Hindi word
 * typed in Latin is far more likely to be listed than to survive rules meant
 * for English.
 */
export function transliterate(word: string): string {
  const source = word.toLowerCase().replace(/[^a-z]/g, '');
  if (source === '') return word;

  const SOFT = new Set(['e', 'i', 'y']);
  const at = (index: number) => source[index] ?? '';
  const isVowel = (letter: string) => letter !== '' && 'aeiou'.includes(letter);

  const groups: [string, string][] = [
    ['tion', 'शन'], ['sion', 'शन'], ['igh', 'ाइ'],
    ['chh', 'छ'], ['tch', 'च'], ['sch', 'श'], ['sh', 'श'], ['ch', 'च'],
    ['kh', 'ख'], ['gh', 'घ'], ['th', 'थ'], ['dh', 'ध'], ['ph', 'फ'],
    ['bh', 'भ'], ['jh', 'झ'], ['zh', 'श'], ['ck', 'क'], ['ng', 'ंग'],
    ['qu', 'क्व'], ['ll', 'ल'], ['tt', 'ट'], ['dd', 'द'], ['pp', 'प'],
    ['rr', 'र'], ['mm', 'म'], ['nn', 'न'], ['bb', 'ब'], ['gg', 'ग'],
    ['kk', 'क'], ['ff', 'फ़'], ['ss', 'स'], ['zz', 'ज़'],
  ];

  const digraphs: [string, { matra: string; solo: string }][] = [
    ['aa', { matra: 'ा', solo: 'आ' }],
    ['ee', { matra: 'ी', solo: 'ई' }],
    ['ea', { matra: 'ी', solo: 'ई' }],
    ['ie', { matra: 'ी', solo: 'ई' }],
    ['oo', { matra: 'ू', solo: 'ऊ' }],
    ['ou', { matra: 'ाउ', solo: 'आउ' }],
    ['oi', { matra: 'ॉय', solo: 'ऑय' }],
    ['oy', { matra: 'ॉय', solo: 'ऑय' }],
    ['oa', { matra: 'ो', solo: 'ओ' }],
    ['ai', { matra: 'े', solo: 'ए' }],
    ['ay', { matra: 'े', solo: 'ए' }],
    ['ey', { matra: 'ी', solo: 'ई' }],
    ['au', { matra: 'ॉ', solo: 'ऑ' }],
    ['ei', { matra: 'े', solo: 'ए' }],
  ];

  const consonant = (index: number): [string, number] => {
    const letter = source[index];
    const next = at(index + 1);

    if (letter === 'c') {
      if (next === 'c' && SOFT.has(at(index + 2))) return ['च्च', 2];
      return [SOFT.has(next) ? 'स' : 'क', 1];
    }
    if (letter === 'g') return [SOFT.has(next) ? 'ज' : 'ग', 1];
    if (letter === 's') return [next === 'h' ? 'श' : 'स', 1];
    if (letter === 'x') return ['क्स', 1];

    const table: Record<string, string> = {
      b: 'ब', d: 'ड', f: 'फ़', h: 'ह', j: 'ज', k: 'क', l: 'ल', m: 'म',
      n: 'न', p: 'प', q: 'क़', r: 'र', t: 'ट', v: 'व', w: 'व', y: 'य', z: 'ज़',
    };

    return [table[letter] ?? '', 1];
  };

  /**
   * A single vowel, as English says it in this position.
   *
   * Three distinctions do all the work, and each one was a mispronunciation
   * before it existed:
   *
   *   an English short O        -> ॉ   "normal" is नॉर्मल, not नोरमाल
   *   a short A in the first syllable -> ै   "cap" is कैप, not काप
   *   an unstressed final a     -> nothing at all   "total" is टोटल
   */
  const single = (index: number): { matra: string; solo: string } | null => {
    const letter = source[index];
    const next = at(index + 1);
    const afterNext = at(index + 2);
    const firstVowel = !/[aeiou]/.test(source.slice(0, index));
    const ending = index + 1 === source.length;

    // A word-final i or u is long: "peri" is पेरी, "menu" मेनू.
    if (ending && letter === 'i') return { matra: 'ी', solo: 'ई' };
    if (ending && letter === 'u') return { matra: 'ू', solo: 'ऊ' };

    // An 'a' before a final consonant, in a word that already had a vowel: an
    // unstressed schwa. "total" is टोटल, not टोटाल. In a one-syllable word
    // the same letters are the vowel itself ("cap" is कैप), which is why the
    // earlier vowel decides.
    if (letter === 'a' && !firstVowel && next !== '' && !isVowel(next) && afterNext === '') {
      return { matra: '', solo: 'अ' };
    }

    if (letter === 'o') {
      // "or" is ॉ in Hindi transliteration -- normal, form, short, fork. It is
      // also the single most common way an English o fooled these rules.
      if (next === 'r' && afterNext !== '' && !isVowel(afterNext)) {
        return { matra: 'ॉ', solo: 'ऑ' };
      }
      // A three-letter word with a closed o: cot, dog, box.
      if (source.length <= 3 && next !== '' && !isVowel(next)) {
        return { matra: 'ॉ', solo: 'ऑ' };
      }
      return { matra: 'ो', solo: 'ओ' };
    }

    if (letter === 'a') {
      // The first a of a word, followed by a consonant that is not itself
      // followed by a vowel: the English short a -- cap, pack, snack.
      if (firstVowel && next !== '' && !isVowel(next) && !isVowel(afterNext)) {
        return { matra: 'ै', solo: 'ऐ' };
      }
      return { matra: 'ा', solo: 'आ' };
    }

    if (letter === 'e') return { matra: 'े', solo: 'ए' };
    if (letter === 'i') return { matra: 'ि', solo: 'इ' };
    if (letter === 'u') return { matra: 'ु', solo: 'उ' };

    return null;
  };

  let out = '';
  let afterConsonant = false;
  let i = 0;

  while (i < source.length) {
    const group = groups.find(([letters]) => source.startsWith(letters, i));
    if (group) {
      // Two consonants with no vowel between them are a cluster, written with
      // a halant: "brownie" is ब्राउनी, not बराउनी (which reads "barauni").
      out += afterConsonant ? `्${group[1]}` : group[1];
      afterConsonant = true;
      i += group[0].length;
      continue;
    }

    // Consonant + "le" at the end: bottle, apple, simple. The l carries an
    // unwritten vowel and the e is silent, so the l stands alone. Without
    // this the schwa-less path writes बोट्ल, which a voice stumbles over --
    // the exact stutter this file exists to avoid.
    if (at(i) === 'l' && at(i + 1) === 'e' && i + 2 === source.length) {
      out += 'ल';
      afterConsonant = false;
      i = source.length;
      continue;
    }

    // "ied" at the end is "ied" as in fried: फ़्राइड, not फ़रीद.
    if (source.startsWith('ied', i) && i + 3 === source.length) {
      out += afterConsonant ? 'ाइड' : 'आइड';
      afterConsonant = true;
      i += 3;
      continue;
    }

    // "ow" is a long o at the end of a word (slow) and "ow" as in brown inside.
    if (source.startsWith('ow', i)) {
      out += i + 2 === source.length ? 'ो' : 'ाउ';
      afterConsonant = false;
      i += 2;
      continue;
    }

    const digraph = digraphs.find(([letters]) => source.startsWith(letters, i));
    if (digraph) {
      const [, letters] = digraph;
      out += afterConsonant ? letters.matra : letters.solo;
      afterConsonant = false;
      i += digraph[0].length;
      continue;
    }

    // Magic e: a single vowel, one consonant, then a silent final e. The vowel
    // is long and the e disappears -- "coke" is कोक, "cake" केक. The consonant
    // between them still has to be written.
    const long: Record<string, string> = { a: 'े', i: 'ाइ', o: 'ो', u: '्यू', e: 'ी' };
    const longForm = long[source[i]];
    if (longForm && at(i + 2) === 'e' && i + 3 === source.length) {
      out += afterConsonant ? longForm : (longSoloOf(source[i]) ?? longForm);
      out += consonant(i + 1)[0];
      afterConsonant = false;
      i = source.length;
      continue;
    }

    const vowel = single(i);
    if (vowel) {
      if (vowel.matra === '') {
        // The consonant before this schwa keeps the previous vowel's sign; the
        // consonant AFTER it must not take a halant, because this unwritten
        // vowel belongs to it. Getting that backwards is what wrote नॉर्म्ल.
        afterConsonant = false;
        i += 1;
        continue;
      }
      out += afterConsonant ? vowel.matra : vowel.solo;
      afterConsonant = false;
      i += 1;
      continue;
    }

    const [letter, width] = consonant(i);
    out += afterConsonant ? `्${letter}` : letter;
    afterConsonant = true;
    i += width;
  }

  return out || word;
}

/** The standalone letter for a magic-e vowel. */
function longSoloOf(letter: string): string | null {
  const table: Record<string, string> = { a: 'ए', i: 'आइ', o: 'ओ', u: 'यू', e: 'ई' };
  return table[letter] ?? null;
}

/**
 * Any text as Devanagari, plus the words that had to be guessed.
 *
 * Devanagari, digits, punctuation and spaces pass through; each Latin run is
 * looked up as a phrase first, then word by word, and transliterated by rule
 * if it is not in the dictionary. Digits become words, because a quantity
 * read by a synthesiser is a quantity that can be misread.
 *
 * `guessed` is the point of returning an object: a rule transliteration is
 * usually right and sometimes wrong, and the owner is the only one who knows
 * which. The menu editor shows this list so a dish can be corrected before a
 * kitchen hears it wrong all evening.
 */
function convert(text: string): { text: string; guessed: string[] } {
  // Numbers first: "2 Butter Naan" has to become "दो Butter Naan" before the
  // word pass, or the digits stay digits.
  const numbered = text.replace(/\d+/g, (digits) => hindiNumber(Number(digits)));

  // Phrase pass. Done on the whole string, longest phrase first, so "butter
  // naan" is never split into two lookups. An entry is only replaced inside
  // word boundaries, so "no" does not eat the "no" inside "noise".
  let replaced = numbered;
  for (const phrase of PHRASES) {
    const word = WORDS[phrase];
    if (!word) continue;
    const pattern = new RegExp(`(?<![a-z])${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z])`, 'gi');
    if (pattern.test(replaced)) replaced = replaced.replace(pattern, word);
  }

  const guessed: string[] = [];

  const spoken = replaced.replace(/[A-Za-z]+/g, (word) => {
    const lower = word.toLowerCase();

    // Both endings, in order: "plates" -> plate, "fries" -> fries (its own
    // entry) then fri. Stripping "es" first would turn "plates" into "plat".
    for (const ending of [/s$/, /es$/]) {
      const stem = lower.replace(ending, '');
      if (stem !== lower && WORDS[stem]) return WORDS[stem];
    }
    if (WORDS[lower]) return WORDS[lower];

    guessed.push(word);
    return transliterate(word);
  });

  return { text: spoken, guessed };
}

export function toDevanagari(text: string): string {
  return convert(text).text;
}

/**
 * The words in a name the dictionary does not know, deduplicated.
 *
 * Empty means every word is known, which is the answer the menu editor wants:
 * nothing to review.
 */
export function unknownWords(text: string): string[] {
  return [...new Set(convert(text).guessed)];
}

/**
 * What the board says for a dish.
 *
 * The restaurant's own written pronunciation wins when it has one. It may be
 * typed in Devanagari or in Latin -- either way it goes through the same
 * conversion, so an override can never put Latin in front of the voice.
 */
export function spokenName(name: string, override?: string | null): string {
  const chosen = (override ?? '').trim() || name;
  return toDevanagari(chosen);
}

/**
 * A guest's note, said the way a person would say it.
 *
 * A note is an INSTRUCTION, not a label. "extra butter" is what the cook
 * should do -- "बटर ज़्यादा डालना" (add more butter) -- and "more spicy" is
 * "तीखा बनाना" (make it spicy). A bare quantity ("ज़्यादा butter") said more
 * of what, not what to do with it, so every quantity gets a verb:
 *
 *   · things that go IN the dish  → "…ज़्यादा डालना" / "…थोड़ा कम डालना"
 *   · things served on the plate  → "…ज़्यादा देना" / "…थोड़ा कम देना"
 *   · qualities (spicy, crispy)   → "…बनाना" / "…ज़्यादा रखना" / "…थोड़ा कम रखना"
 *
 * Hindi puts the negation last ("प्याज़ नहीं"), and anything that does not
 * match a pattern is still translated word for word -- the honest fallback.
 */

/** How the dish should come OUT -- बनाना / रखना, never डालना. */
const QUALITY: Record<string, string> = {
  spicy: 'तीखा', crispy: 'कुरकुरा', crunchy: 'कुरकुरा', hot: 'गरम', warm: 'गरम',
  sweet: 'मीठा', salty: 'नमकीन', soft: 'नरम', fresh: 'ताज़ा',
};

/**
 * Things that arrive on the plate -- "…देना" (give), never "…डालना" (put IN):
 * "extra roti" is "रोटी ज़्यादा देना", "extra butter" is "बटर ज़्यादा डालना".
 */
const SERVE: ReadonlySet<string> = new Set([
  'roti', 'naan', 'rice', 'biryani', 'pulao', 'paratha', 'kulcha', 'puri', 'dosa',
  'idli', 'thali', 'dal', 'daal', 'sabzi', 'soup', 'salad', 'raita', 'papad',
  'water', 'lassi', 'chai', 'tea', 'coffee', 'juice', 'plate', 'glass', 'napkin',
  'tissue', 'spoon', 'fork', 'curd', 'cake', 'dessert',
]);

/** The dish names WORDS knows whole ("butter naan") — longest first. */
const DISHES: string = PHRASES.filter((phrase) => phrase.includes(' ')).join('|');

/**
 * True when the word after a governed one continues a dish name: a quantity
 * in front of one sizes the serving ("extra paneer tikka" is more of the
 * dish), so those words are left to the fallback rules below.
 */
function continuesDish(next: string | undefined): boolean {
  return Boolean(next && Object.prototype.hasOwnProperty.call(WORDS, next.toLowerCase()));
}

/**
 * The instruction frames. Each fires only when the word it governs is not
 * followed by another dish word -- see continuesDish.
 */
function toInstruction(text: string): string {
  const quality = (word: string) => QUALITY[word.toLowerCase()];
  /** The Latin word after the match, if any -- a dish word means "sizes the serving". */
  const nextWord = (whole: string, offset: number, str: string): string | undefined =>
    /^\s+([a-z]+)/i.exec(str.slice(offset + whole.length))?.[1];
  return (
    text
      // Courtesies and framing verbs are not part of the instruction.
      .replace(/\b(?:please|pls|plz|kindly|thank you|thanks|thx)\b/gi, '')
      .replace(/\bmake(?:\s+it)?\b/gi, '')
      // "don't add onion" → "onion मत डालना".
      .replace(/\bdon'?t\s+(?:add|put|use|include)\s+([a-z]+)/gi, '$1 मत डालना')
      // "no more butter" → "बटर और नहीं" -- a quantity inside a negation.
      .replace(new RegExp(`\\b(?:no|not|without)\\s+(?:more|extra)\\s+(${DISHES})\\b`, 'gi'), '$1 और नहीं')
      .replace(/\b(?:no|not|without)\s+(?:more|extra)\s+([a-z]+)/gi, '$1 और नहीं')
      // Negation, Hindi style -- last. A dish name negates whole:
      // "no butter chicken" → "बटर चिकन नहीं".
      .replace(new RegExp(`\\b(?:no|not)\\s+(${DISHES})\\b`, 'gi'), '$1 नहीं')
      .replace(new RegExp(`\\bwithout\\s+(${DISHES})\\b`, 'gi'), '$1 के बिना')
      .replace(/\b(?:no|not)\s+([a-z]+)/gi, (_m, w: string) => `${quality(w) ?? w} नहीं`)
      .replace(/\bwithout\s+([a-z]+)/gi, (_m, w: string) => `${quality(w) ?? w} के बिना`)
      // Quantities: "extra butter" → "बटर ज़्यादा डालना", "more spicy" →
      // "तीखा बनाना", "extra roti" → "रोटी ज़्यादा देना".
      .replace(
        /\b(more|extra|less)\s+([a-z]+)/gi,
        (whole, qty: string, word: string, offset: number, str: string) => {
          if (continuesDish(nextWord(whole, offset, str))) return whole;
          const state = quality(word);
          const verb = SERVE.has(word.toLowerCase()) ? 'देना' : 'डालना';
          if (qty.toLowerCase() === 'more') return state ? `${state} बनाना` : `${word} ज़्यादा ${verb}`;
          if (qty.toLowerCase() === 'extra') return state ? `${state} ज़्यादा रखना` : `${word} ज़्यादा ${verb}`;
          return state ? `${state} थोड़ा कम रखना` : `${word} थोड़ा कम ${verb}`;
        },
      )
      // A quality word alone IS the instruction: "spicy" → "तीखा बनाना".
      .replace(
        new RegExp(`\\b(${Object.keys(QUALITY).join('|')})\\b`, 'gi'),
        (whole, word: string, offset: number, str: string) =>
          (continuesDish(nextWord(whole, offset, str)) ? whole : `${QUALITY[word.toLowerCase()]} बनाना`),
      )
  );
}

const NOTE_REWRITES: [RegExp, string][] = [
  // Whole phrases, so the word-level rules below cannot mangle them into
  // transliterated gibberish ("on the side" must never reach the voice as
  // "ऑन थे साइड" -- a note is an instruction, not sounds).
  [/\bon the side\b/gi, 'अलग से देना है'],
  [/\bpack (?:it )?separately\b/gi, 'अलग से पैक करना'],
  [/\basap\b/gi, 'जल्दी करना है'],
  // Clause words.
  [/\band\b/gi, 'और'],
  [/\bor\b/gi, 'या'],
  [/\bbut\b/gi, 'लेकिन'],
  [/\bin\b/gi, 'में'],
  [/\bwith\b/gi, 'के साथ'],
  [/\bfor\b/gi, 'के लिए'],
  // Fallback: a quantity in front of a dish name sizes the serving, and the
  // name must survive whole -- "extra paneer tikka" → "ज़्यादा पनीर टिक्का".
  [/\bless\s+([a-z]+)/gi, 'कम $1'],
  [/\bextra\s+([a-z]+)/gi, 'ज़्यादा $1'],
  [/\bmore\s+([a-z]+)/gi, 'ज़्यादा $1'],
];

export function noteToDevanagari(text: string): string {
  let out = toInstruction(text).replace(/\s+/g, ' ').trim();
  for (const [pattern, replacement] of NOTE_REWRITES) out = out.replace(pattern, replacement);
  return toDevanagari(out.replace(/\s+/g, ' ').trim());
}

/** True when every letter of the text is Devanagari or punctuation. */
export function isDevanagariOnly(text: string): boolean {
  return !/[A-Za-z]/.test(text);
}

/** Exported for the tests that pin the dictionary's coverage. */
