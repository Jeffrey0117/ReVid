import { Icon } from './Icon';

export const ArrowDownToLine = ({ size, className, ...props }) => (
    <Icon size={size} className={className} {...props}>
        <path d="M12 17V3" />
        <path d="m6 11 6 6 6-6" />
        <path d="M19 21H5" />
    </Icon>
);
