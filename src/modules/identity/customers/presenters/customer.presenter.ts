import type {
  CustomerAddress,
  CustomerProfile,
} from '@generated/prisma/client';
import type { DOCUMENT_TYPE, TYPE_CUSTOMER } from '@generated/prisma/enums';

export interface CustomerProfileResponse {
  id: string;
  customerType: TYPE_CUSTOMER;
  documentType: DOCUMENT_TYPE;
  documentNumber: string;
  companyName: string | null;
  billingEmail: string | null;
  createdAt: Date;
}

export interface CustomerAddressResponse {
  id: string;
  label: string;
  addressLine: string;
  city: string;
  province: string;
  countryCode: string | null;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  isDefault: boolean;
  createdAt: Date;
}

export function toCustomerProfileResponse(
  profile: CustomerProfile,
): CustomerProfileResponse {
  return {
    id: profile.id,
    customerType: profile.customerType,
    documentType: profile.documentType,
    documentNumber: profile.documentNumber,
    companyName: profile.companyName,
    billingEmail: profile.billingEmail,
    createdAt: profile.createdAt,
  };
}

export function toCustomerAddressResponse(
  address: CustomerAddress,
): CustomerAddressResponse {
  return {
    id: address.id,
    label: address.label,
    addressLine: address.addressesLine,
    city: address.city,
    province: address.province,
    countryCode: address.countryCode,
    postalCode: address.postalCode,
    latitude: address.latitude === null ? null : Number(address.latitude),
    longitude: address.longitude === null ? null : Number(address.longitude),
    isDefault: address.isDefault,
    createdAt: address.createdAt,
  };
}
