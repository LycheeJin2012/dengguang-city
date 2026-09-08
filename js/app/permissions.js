export const canSeeMunicipalLink=session=>Boolean(session?.player?.linked_admin_id);
export const canSeeHotelOwnerLink=session=>Boolean(session?.hotel_owner);
