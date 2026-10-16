import { Member, CustomField } from '../types/member';
import { Card, CardContent } from './ui/card';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { Badge } from './ui/badge';
import { ImageWithFallback } from './figma/ImageWithFallback';

interface MemberCardProps {
  member: Member;
  customFields: CustomField[];
  onClick: () => void;
  onPhotoClick?: (photo: string, name: string) => void;
}

export function MemberCard({ member, customFields, onClick, onPhotoClick }: MemberCardProps) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case '在职': return 'bg-green-100 text-green-800 border-green-200';
      case '劝退': return 'bg-red-100 text-red-800 border-red-200';
      case '光荣退休': return 'bg-blue-100 text-blue-800 border-blue-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const renderFieldValue = (field: CustomField, value: any) => {
    if (!value) return '-';

    switch (field.type) {
      case 'images':
        if (Array.isArray(value) && value.length > 0) {
          return (
            <div className="flex gap-1 flex-wrap">
              {value.slice(0, 3).map((img, idx) => (
                <ImageWithFallback
                  key={idx}
                  src={img}
                  alt=""
                  className="w-8 h-8 object-cover rounded"
                />
              ))}
              {value.length > 3 && (
                <div className="w-8 h-8 bg-muted rounded flex items-center justify-center text-xs">
                  +{value.length - 3}
                </div>
              )}
            </div>
          );
        }
        return '-';
      case 'date':
        // Format date as YYYY-MM-DD to comply with project specification
        const date = new Date(value);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      default:
        return value.toString();
    }
  };

  return (
    <Card
      className="cursor-pointer hover:shadow-lg transition-shadow"
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-4">
          <Avatar
            className="h-16 w-16 cursor-pointer hover:opacity-80 transition-opacity"
            onClick={(e) => {
              if (member.data.photo && onPhotoClick) {
                e.stopPropagation();
                onPhotoClick(member.data.photo, member.data.name);
              }
            }}
          >
            <AvatarImage src={member.data.photo} alt={member.data.name} />
            <AvatarFallback>{member.data.name[0]}</AvatarFallback>
          </Avatar>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <h3 className="font-medium truncate">{member.data.name}</h3>
              <Badge variant="outline" className={getStatusColor(member.data.status)}>
                {member.data.status}
              </Badge>
            </div>

            <div className="space-y-1 text-sm text-muted-foreground">
              <div>QQ: {member.data.qq}</div>
              <div>性别: {member.data.gender}</div>

              {customFields
                .filter(f => !f.hidden && member.data[f.id])
                .slice(0, 2)
                .map(field => (
                  <div key={field.id} className="truncate">
                    {field.name}: {renderFieldValue(field, member.data[field.id])}
                  </div>
                ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
