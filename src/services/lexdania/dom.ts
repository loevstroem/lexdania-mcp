/**
 * Minimal structural view of the xmldom nodes we touch. Declaring these locally
 * keeps the browser "dom" lib out of tsconfig (it would collide with the Workers
 * runtime globals from @cloudflare/workers-types).
 */
export interface XmlAttr {
  name: string;
  value: string;
  ownerElement?: XmlElement | null;
}

export interface XmlNamedNodeMap {
  length: number;
  item(index: number): XmlAttr | null;
}

export interface XmlNodeList {
  length: number;
  item(index: number): XmlNode | null;
}

export interface XmlNode {
  nodeType: number;
  data?: string;
  nodeValue?: string | null;
  childNodes: XmlNodeList;
  parentNode?: XmlNode | null;
}

export interface XmlElement extends XmlNode {
  tagName: string;
  attributes: XmlNamedNodeMap;
}

export interface XmlDocument {
  documentElement: XmlElement | null;
}

export const ELEMENT_NODE = 1;
export const ATTRIBUTE_NODE = 2;
export const TEXT_NODE = 3;
export const CDATA_NODE = 4;
