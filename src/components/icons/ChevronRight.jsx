import { Icon } from './Icon';

export const ChevronRight = ({ size, className, ...props }) => (
    <Icon size={size} className={className} {...props}>
        <polyline points="9 18 15 12 9 6" />
    </Icon>
);
